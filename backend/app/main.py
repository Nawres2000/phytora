"""PHYTORA model API (FastAPI, asynchronous, Pydantic-validated). Swagger UI: http://localhost:8000/docs

Endpoints
- GET  /health             server status, GPU, loaded model version
- GET  /model/metadata     architecture, classes, validation/test metrics, ONNX variants benchmark
- POST /predict            image -> top-k diagnosis (+ severity, + optional Grad-CAM heat map)
- POST /predict/visualize  image -> annotated PNG (Grad-CAM, Score-CAM or severity mask)
- POST /predict/batch      several images in one call
- GET  /metrics            Prometheus metrics (system + model + drift)
- GET  /monitoring/drift   last data / prediction drift check
- POST /admin/reload       reload the model after a promotion (X-Admin-Token header)

Run from the repository root: uvicorn backend.app.main:app --port 8000
Env: MODEL_DIR, ONNX_VARIANT (fp32|int8|fp16), MIN_CONFIDENCE, MIN_MARGIN, MOCK=1, CORS_ORIGINS,
     PREDICTION_LOG, DRIFT_SUMMARY, ADMIN_TOKEN
"""

import json
import os
import time
from contextlib import asynccontextmanager
from io import BytesIO
from typing import Annotated, Literal, Optional

from fastapi import Depends, FastAPI, File, Header, HTTPException, Query, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse, Response
from PIL import Image, ImageOps, UnidentifiedImageError

from backend.app import inference, monitoring
from backend.app.schemas import (
    BatchItem,
    BatchResponse,
    ErrorResponse,
    HealthResponse,
    MetadataResponse,
    PredictionResponse,
)
from src.monitoring.features import image_stats
from src.utils.gradcam import overlay, to_bytes, to_data_url
from src.utils.severity import estimate_severity, severity_overlay

MAX_BYTES = int(os.getenv("MAX_UPLOAD_MB", "8")) * 1024 * 1024
MAX_PIXELS = 40_000_000
ALLOWED = {"image/jpeg", "image/png", "image/webp"}
ERRORS = {
    400: {"model": ErrorResponse, "description": "Not a valid image"},
    413: {"model": ErrorResponse, "description": "Image too large"},
    503: {"model": ErrorResponse, "description": "Model not loaded yet"},
}


def load_service(state: dict) -> None:
    state["error"] = None
    try:
        state["service"] = inference.MockService() if os.getenv("MOCK") == "1" else inference.ModelService()
        print("Model loaded:", state["service"].version, "| engine:", state["service"].engine, "| variant:", state["service"].variant)
        if os.getenv("WARMUP_EXPLAIN", "1") == "1" and state["service"].explain_available:
            state["service"]._torch_model()  # load the PyTorch copy now, not on the first Grad-CAM request
    except Exception as e:  # missing model files: the API still starts and answers 503
        state["service"] = None
        state["error"] = f"{type(e).__name__}: {e}"
        print("Model NOT loaded ->", state["error"])
    monitoring.set_model(state["service"])
    monitoring.log_event(
        {
            "event": "model_loaded" if state["service"] else "model_load_failed",
            "version": getattr(state["service"], "version", None),
            "error": state["error"],
        }
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.started = time.time()
    app.state.model = {}
    load_service(app.state.model)
    yield


app = FastAPI(
    title="PHYTORA Model API",
    version="2.0.0",
    description="Diagnostic des maladies foliaires (38 classes PlantVillage) : MobileNetV3 servi par ONNX Runtime, "
    "explicabilité Grad-CAM / Score-CAM, estimation de la sévérité.",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:3000").split(","),
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
    expose_headers=["X-Class-Id", "X-Confidence", "X-Latency-Ms", "X-Severity-Percent"],
)


@app.middleware("http")
async def http_metrics(request: Request, call_next):
    """Prometheus request count / latency per route template (not per raw URL: bounded cardinality)."""
    t0 = time.perf_counter()
    status = 500
    try:
        response = await call_next(request)
        status = response.status_code
        return response
    finally:
        route = request.scope.get("route")
        path = getattr(route, "path", "unmatched")
        if path != "/metrics":
            monitoring.REQUESTS.labels(request.method, path, str(status)).inc()
            monitoring.LATENCY.labels(path).observe(time.perf_counter() - t0)


def get_service(request: Request):
    service = request.app.state.model.get("service")
    if service is None:
        raise HTTPException(status_code=503, detail="Le modèle n'est pas encore chargé (voir GET /health).")
    return service


Service = Annotated[object, Depends(get_service)]


async def read_image(file: UploadFile) -> Image.Image:
    if file.content_type not in ALLOWED:
        raise HTTPException(status_code=400, detail="Format non pris en charge : envoyez une image JPEG, PNG ou WebP.")
    data = await file.read()
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail=f"Image trop volumineuse ({MAX_BYTES // 1024 // 1024} Mo maximum).")
    try:
        image = Image.open(BytesIO(data))
        if image.width * image.height > MAX_PIXELS:
            raise HTTPException(status_code=413, detail="Image trop grande (40 mégapixels maximum).")
        return ImageOps.exif_transpose(image).convert("RGB")  # phone photos are often rotated via EXIF
    except HTTPException:
        raise
    except (UnidentifiedImageError, OSError, ValueError):
        raise HTTPException(status_code=400, detail="Image illisible ou corrompue.")


def run_prediction(service, image, top_k: int, explain: bool, method: str, with_severity: bool, route: str = "/predict") -> dict:
    t0 = time.perf_counter()
    out = service.predict(image, top_k)
    top = [{**c, **inference.describe(c["class_id"])} for c in out["top_k"]]
    best = top[0]
    result = {
        "class_id": best["class_id"],
        "confidence": best["score"],
        "top_k": top,
        "uncertain": inference.is_uncertain([c["score"] for c in top]),
        "severity": estimate_severity(image) if with_severity and not best["healthy"] else None,
        "heatmap": None,
        "explain_method": None,
        "model_version": service.version,
        "engine": service.engine,
        "variant": service.variant,
        "mock": service.engine == "mock",
    }
    explain_ms = 0.0
    if explain and service.explain_available:
        te = time.perf_counter()
        cam = service.explain(image, method, best["class_id"])
        small = image.copy()
        small.thumbnail((448, 448))
        result["heatmap"] = to_data_url(overlay(small, cam))
        result["explain_method"] = method
        explain_ms = (time.perf_counter() - te) * 1000
    total = (time.perf_counter() - t0) * 1000
    result["latency"] = {
        "preprocess_ms": round(out["preprocess_ms"], 2),
        "inference_ms": round(out["inference_ms"], 2),
        "explain_ms": round(explain_ms, 2),
        "total_ms": round(total, 2),
    }
    result["latency_ms"] = round(total, 2)
    monitoring.record_prediction(result, image_stats(image), route)  # metrics + JSON log (drift input)
    return result


@app.get("/", include_in_schema=False)
async def root():
    return RedirectResponse("/docs")


@app.get("/health", response_model=HealthResponse, tags=["service"], summary="État du serveur, GPU et version du modèle")
async def health(request: Request):
    state = request.app.state.model
    s = state.get("service")
    return HealthResponse(
        status="ok" if s else "degraded",
        model_loaded=s is not None,
        model_version=getattr(s, "version", None),
        engine=getattr(s, "engine", None),
        variant=getattr(s, "variant", None),
        explain_available=bool(s and s.explain_available),
        gpu=s.gpu() if s else {"available": False, "name": None, "providers": []},
        mock=bool(s and s.engine == "mock"),
        uptime_s=round(time.time() - request.app.state.started, 1),
        error=state.get("error"),
        min_confidence=inference.MIN_CONFIDENCE,
        min_margin=inference.MIN_MARGIN,
    )


@app.get(
    "/model/metadata",
    response_model=MetadataResponse,
    tags=["service"],
    responses={503: ERRORS[503]},
    summary="Caractéristiques du modèle : architecture, métriques, classes, variantes ONNX",
)
async def metadata(service: Service):
    m = dict(service.meta)
    m.setdefault("benchmark", {})
    m.setdefault("variants", {})
    m["serve_variant"] = service.variant or m.get("serve_variant", "none")
    m["engine"] = service.engine
    m["thresholds"] = {"min_confidence": inference.MIN_CONFIDENCE, "min_margin": inference.MIN_MARGIN}
    return m


@app.post("/predict", response_model=PredictionResponse, tags=["inference"], responses=ERRORS, summary="Diagnostic d'une image de feuille")
async def predict(
    service: Service,
    file: UploadFile = File(..., description="Photo d'une feuille (JPEG, PNG ou WebP, 8 Mo max)"),
    top_k: int = Query(3, ge=1, le=10, description="Nombre d'hypothèses renvoyées"),
    explain: bool = Query(False, description="Ajouter la carte Grad-CAM (data URL JPEG)"),
    method: Literal["gradcam", "scorecam"] = Query("gradcam", description="Méthode d'explicabilité"),
    severity: bool = Query(True, description="Estimer la part de la feuille atteinte"),
):
    image = await read_image(file)
    return await run_in_threadpool(run_prediction, service, image, top_k, explain, method, severity)


@app.post(
    "/predict/visualize",
    tags=["inference"],
    responses={**ERRORS, 200: {"content": {"image/png": {}}}, 501: {"model": ErrorResponse, "description": "Explanation unavailable"}},
    response_class=Response,
    summary="Image annotée : carte Grad-CAM, Score-CAM ou masque de sévérité",
)
async def visualize(
    service: Service,
    file: UploadFile = File(...),
    overlay_type: Literal["gradcam", "scorecam", "severity"] = Query("gradcam", alias="overlay"),
    class_id: Optional[str] = Query(None, description="Classe à expliquer (par défaut : la classe prédite)"),
):
    image = await read_image(file)

    def work():
        t0 = time.perf_counter()
        out = service.predict(image, 2)
        best = out["top_k"][0]
        sev = estimate_severity(image)
        if overlay_type == "severity":
            png = to_bytes(severity_overlay(image))
        else:
            if not service.explain_available:
                raise HTTPException(status_code=501, detail="Explicabilité indisponible : PyTorch ou le checkpoint .pt est absent.")
            cam = service.explain(image, overlay_type, class_id or best["class_id"])
            small = image.copy()
            small.thumbnail((512, 512))
            png = to_bytes(overlay(small, cam))
        headers = {
            "X-Class-Id": best["class_id"],
            "X-Confidence": str(best["score"]),
            "X-Latency-Ms": f"{(time.perf_counter() - t0) * 1000:.1f}",
            "X-Severity-Percent": "" if sev["percent"] is None else str(sev["percent"]),
        }
        return Response(content=png, media_type="image/png", headers=headers)

    return await run_in_threadpool(work)


@app.post(
    "/predict/batch",
    response_model=BatchResponse,
    tags=["inference"],
    responses={503: ERRORS[503]},
    summary="Diagnostic de plusieurs images (16 max)",
)
async def predict_batch(service: Service, files: list[UploadFile] = File(...), top_k: int = Query(3, ge=1, le=10)):
    if len(files) > 16:
        raise HTTPException(status_code=400, detail="16 images maximum par requête.")
    t0 = time.perf_counter()
    items = []
    for f in files:
        try:
            image = await read_image(f)
            pred = await run_in_threadpool(run_prediction, service, image, top_k, False, "gradcam", True, "/predict/batch")
            items.append(BatchItem(filename=f.filename, prediction=pred))
        except HTTPException as e:
            items.append(BatchItem(filename=f.filename, error=e.detail))
    return BatchResponse(count=len(items), items=items, latency_ms=round((time.perf_counter() - t0) * 1000, 2))


@app.get("/metrics", tags=["monitoring"], summary="Métriques Prometheus (système, modèle, dérive)", response_class=Response)
async def metrics():
    body, ctype = monitoring.metrics_payload()
    return Response(content=body, media_type=ctype)


@app.get("/monitoring/drift", tags=["monitoring"], summary="Résultat du dernier contrôle de dérive (Evidently)")
async def drift():
    try:
        return json.loads(monitoring.DRIFT_SUMMARY.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"status": "never_checked", "message": "Aucun contrôle de dérive encore exécuté (flow Prefect monitoring)."}


@app.post("/admin/reload", tags=["service"], summary="Recharger le modèle (après une promotion en production)")
async def reload_model(request: Request, x_admin_token: Optional[str] = Header(None)):
    expected = os.getenv("ADMIN_TOKEN")
    if not expected or x_admin_token != expected:
        raise HTTPException(status_code=403, detail="Jeton d'administration invalide ou rechargement désactivé.")
    previous = getattr(request.app.state.model.get("service"), "version", None)
    new_state: dict = {}
    await run_in_threadpool(load_service, new_state)
    if new_state.get("service") is None:  # keep serving the previous model: automatic rollback
        monitoring.set_model(request.app.state.model.get("service"))
        raise HTTPException(status_code=500, detail=f"Rechargement échoué, modèle précédent conservé : {new_state.get('error')}")
    request.app.state.model = new_state
    return {"reloaded": True, "previous_version": previous, "version": new_state["service"].version}
