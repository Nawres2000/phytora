"""API tests (pytest + FastAPI TestClient). A fake service replaces the model, so no weights are needed;
one extra test runs the real ONNX model when models/legacy (DVC) is present."""

import io

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from backend.app import inference
from backend.app.main import app

CLASSES = ["Tomato___healthy", "Tomato___Late_blight", "Potato___Early_blight"]


class FakeService:
    engine, variant, version = "onnxruntime", "fp32", "fake-1"

    def __init__(self, scores=(0.9, 0.07, 0.03), explain=True):
        self.scores, self.explain_available = scores, explain
        self.meta = {
            "name": "fake",
            "architecture": "mobilenet_v3_small",
            "version": "fake-1",
            "task": "test",
            "framework": "none",
            "num_classes": 3,
            "classes": CLASSES,
            "img_size": 224,
            "input": {"mean": [0, 0, 0]},
            "output": {},
            "metrics": {"test_macro_f1": 0.98},
            "serve_variant": "fp32",
            "variants": {"fp32": {"file": "model.onnx"}},
        }
        self.calls = 0

    def gpu(self):
        return {"available": False, "name": None, "providers": ["CPUExecutionProvider"]}

    def predict(self, image, top_k=3):
        self.calls += 1
        order = [1, 0, 2]
        return {
            "top_k": [{"class_id": CLASSES[i], "score": s} for i, s in zip(order, self.scores)][:top_k],
            "preprocess_ms": 1.0,
            "inference_ms": 2.0,
        }

    def explain(self, image, method="gradcam", class_id=None):
        return np.random.rand(16, 16)


def png_bytes(color=(40, 150, 40), size=(64, 64), fmt="PNG"):
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, fmt)
    return buf.getvalue()


@pytest.fixture
def client():
    with TestClient(app) as c:
        app.state.model = {"service": FakeService(), "error": None}
        yield c


def upload(data=None, name="leaf.png", ctype="image/png"):
    return {"file": (name, data if data is not None else png_bytes(), ctype)}


def test_health_ok(client):
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok" and body["model_loaded"] and body["model_version"] == "fake-1"
    assert body["gpu"]["available"] is False and "CPUExecutionProvider" in body["gpu"]["providers"]


def test_health_degraded_without_model(client):
    app.state.model = {"service": None, "error": "FileNotFoundError: metadata.json"}
    body = client.get("/health").json()
    assert body["status"] == "degraded" and not body["model_loaded"] and "metadata" in body["error"]


def test_metadata(client):
    r = client.get("/model/metadata")
    assert r.status_code == 200
    m = r.json()
    assert m["num_classes"] == 3 and m["classes"] == CLASSES and m["engine"] == "onnxruntime"
    assert m["thresholds"]["min_confidence"] == inference.MIN_CONFIDENCE


def test_predict_structure(client):
    r = client.post("/predict", files=upload())
    assert r.status_code == 200, r.text
    p = r.json()
    assert p["class_id"] == "Tomato___Late_blight" and p["confidence"] == 0.9
    assert p["top_k"][0]["plant"] == "Tomato" and p["top_k"][0]["condition"] == "Late blight" and not p["top_k"][0]["healthy"]
    assert p["uncertain"] is False
    assert p["severity"]["level"] and p["latency"]["inference_ms"] == 2.0 and p["latency_ms"] >= 0
    assert p["heatmap"] is None


def test_predict_with_gradcam(client):
    p = client.post("/predict?explain=true&top_k=2", files=upload()).json()
    assert p["heatmap"].startswith("data:image/jpeg;base64,") and p["explain_method"] == "gradcam"
    assert len(p["top_k"]) == 2


def test_predict_uncertain_flag(client):
    app.state.model["service"] = FakeService(scores=(0.45, 0.40, 0.15))
    assert client.post("/predict", files=upload()).json()["uncertain"] is True


def test_predict_rejects_non_image(client):
    r = client.post("/predict", files=upload(b"hello", "notes.txt", "text/plain"))
    assert r.status_code == 400
    r = client.post("/predict", files=upload(b"not really a png", "fake.png", "image/png"))
    assert r.status_code == 400 and "illisible" in r.json()["detail"]


def test_predict_validates_query(client):
    assert client.post("/predict?top_k=0", files=upload()).status_code == 422
    assert client.post("/predict?method=lime", files=upload()).status_code == 422


def test_predict_503_when_model_missing(client):
    app.state.model = {"service": None, "error": "x"}
    assert client.post("/predict", files=upload()).status_code == 503
    assert client.get("/model/metadata").status_code == 503


def test_visualize_returns_png(client):
    for kind in ("gradcam", "severity"):
        r = client.post(f"/predict/visualize?overlay={kind}", files=upload(png_bytes(fmt="JPEG"), "leaf.jpg", "image/jpeg"))
        assert r.status_code == 200 and r.headers["content-type"] == "image/png"
        assert r.content[:8] == b"\x89PNG\r\n\x1a\n" and r.headers["x-class-id"] == "Tomato___Late_blight"


def test_visualize_501_without_explanations(client):
    app.state.model["service"] = FakeService(explain=False)
    assert client.post("/predict/visualize", files=upload()).status_code == 501


def test_batch(client):
    files = [("files", ("a.png", png_bytes(), "image/png")), ("files", ("b.txt", b"x", "text/plain"))]
    b = client.post("/predict/batch", files=files).json()
    assert b["count"] == 2 and b["items"][0]["prediction"]["class_id"] and b["items"][1]["error"]


def test_describe_and_uncertainty_rules():
    assert inference.describe("Pepper,_bell___Bacterial_spot") == {"plant": "Pepper bell", "condition": "Bacterial spot", "healthy": False}
    assert inference.describe("Apple___healthy")["healthy"] is True
    assert inference.is_uncertain([0.55, 0.3]) and inference.is_uncertain([0.7, 0.65]) and not inference.is_uncertain([0.9, 0.05])


def test_real_onnx_model_if_available():
    """End-to-end with the real model files (skipped in CI where DVC artefacts are not pulled)."""
    model_dir = inference.default_model_dir()
    if not (model_dir / "metadata.json").exists() or not (model_dir / "model.onnx").exists():
        pytest.skip("model artefacts not pulled (dvc pull)")
    svc = inference.ModelService(model_dir)
    out = svc.predict(Image.new("RGB", (300, 200), (40, 150, 40)), 3)
    assert len(out["top_k"]) == 3 and abs(sum(c["score"] for c in out["top_k"])) <= 1.0001
    assert out["top_k"][0]["class_id"] in svc.classes
