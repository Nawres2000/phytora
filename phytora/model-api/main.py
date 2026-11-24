"""PHYTORA model API (FastAPI). Only the Express backend calls this service.

Classification: MobileNetV3-Small (models/mobilenet_v3_small_best.pt) with Grad-CAM.
Weed detection: no model yet, fill in `detect_weeds`.
MOCK=1 returns random demo results (flagged "mock": true) so you can test the app without any model.

Env: MIN_CONFIDENCE (default 0.60) and MIN_MARGIN (default 0.10): below these the result is flagged "uncertain".
"""
import json
import os
import random
import time
from contextlib import asynccontextmanager
from io import BytesIO
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.concurrency import run_in_threadpool
from PIL import Image, ImageOps
from pydantic import BaseModel

MOCK = os.getenv("MOCK") == "1"
MIN_CONFIDENCE = float(os.getenv("MIN_CONFIDENCE", "0.60"))
MIN_MARGIN = float(os.getenv("MIN_MARGIN", "0.10"))
MAX_PIXELS = 40_000_000
MODEL_DIR = Path(__file__).parent / "models"
state = {"classifier": None, "classes": [], "error": None}


@asynccontextmanager
async def lifespan(app: FastAPI):
    state["classes"] = list(json.load(open(MODEL_DIR / "classes.json", encoding="utf-8")))
    try:
        from classifier import DiseaseClassifier  # imported lazily: torch is heavy
        state["classifier"] = DiseaseClassifier()
        print("Classifier loaded:", state["classifier"].version)
    except Exception as e:  # missing torch or checkpoint: the API still starts (501 / MOCK)
        state["error"] = f"{type(e).__name__}: {e}"
        print("Classifier NOT loaded ->", state["error"])
    yield


app = FastAPI(title="PHYTORA Model API", lifespan=lifespan)


class Candidate(BaseModel):
    class_id: str
    score: float


class BoundingBox(BaseModel):
    x: float
    y: float
    width: float
    height: float
    label: str
    confidence: float
    color: str


class PredictionResponse(BaseModel):
    task: str
    class_id: Optional[str] = None
    confidence: Optional[float] = None
    top_k: list[Candidate] = []
    uncertain: bool = False
    heatmap: Optional[str] = None
    model_version: Optional[str] = None
    counts: Optional[dict] = None
    predictions: list[BoundingBox] = []
    latency_ms: float
    mock: bool = False


def detect_weeds(image: Image.Image) -> tuple[dict, list[BoundingBox]]:
    # TODO: run your weed detector. Return ({"weeds": n, "crops": m}, [BoundingBox, ...]).
    raise NotImplementedError


def is_uncertain(top_k: list[dict]) -> bool:
    best = top_k[0]["score"]
    second = top_k[1]["score"] if len(top_k) > 1 else 0.0
    return best < MIN_CONFIDENCE or (best - second) < MIN_MARGIN


@app.get("/health")
def health():
    c = state["classifier"]
    return {"status": "ok", "mock": MOCK, "classification": bool(c) or MOCK, "detection": MOCK,
            "model_version": c.version if c else None, "error": state["error"],
            "min_confidence": MIN_CONFIDENCE, "min_margin": MIN_MARGIN}


@app.post("/predict", response_model=PredictionResponse)
async def predict(
    file: UploadFile = File(...),
    task: str = Query("classification", pattern="^(classification|detection)$"),
    explain: bool = True,
):
    start = time.time()
    if file.content_type not in ["image/jpeg", "image/png", "image/webp"]:
        raise HTTPException(status_code=400, detail="Format d'image non supporté.")
    try:
        image = Image.open(BytesIO(await file.read()))
        if image.width * image.height > MAX_PIXELS:
            raise HTTPException(status_code=413, detail="Image trop grande.")
        image = ImageOps.exif_transpose(image).convert("RGB")  # phone photos are often rotated via EXIF
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=400, detail="Image illisible.")

    latency = lambda: round((time.time() - start) * 1000, 2)

    if MOCK:
        time.sleep(0.5)
        if task == "classification":
            ids = random.sample(state["classes"], 3)
            scores = sorted([round(random.uniform(0.7, 0.97), 3), round(random.uniform(0.02, 0.2), 3), 0.01], reverse=True)
            top = [{"class_id": i, "score": s} for i, s in zip(ids, scores)]
            return PredictionResponse(task=task, mock=True, class_id=ids[0], confidence=scores[0], top_k=top,
                                      model_version="mock", latency_ms=latency())
        return PredictionResponse(task=task, mock=True, latency_ms=latency(),
                                  counts={"weeds": random.randint(2, 10), "crops": random.randint(1, 5)})

    try:
        if task == "classification":
            clf = state["classifier"]
            if clf is None:
                raise HTTPException(status_code=503, detail="Le modèle de classification n'est pas chargé (voir les journaux de model-api).")
            out = await run_in_threadpool(clf.predict, image, 3, explain)
            return PredictionResponse(task=task, class_id=out["top_k"][0]["class_id"], confidence=out["top_k"][0]["score"],
                                      top_k=out["top_k"], uncertain=is_uncertain(out["top_k"]), heatmap=out["heatmap"],
                                      model_version=clf.version, latency_ms=latency())
        counts, boxes = detect_weeds(image)
        return PredictionResponse(task=task, counts=counts, predictions=boxes, latency_ms=latency())
    except NotImplementedError:
        raise HTTPException(status_code=501, detail="La détection de mauvaises herbes n'est pas encore disponible.")
