"""Inference engine wrapper: ONNX Runtime for predictions, PyTorch (optional, lazy) for explanations.

- the ONNX file served is chosen by metadata.json `serve_variant` or the ONNX_VARIANT env var (fp32 | int8 | fp16);
- preprocessing is identical to training: RGB -> bilinear resize -> /255 -> ImageNet mean/std -> NCHW;
- Grad-CAM / Score-CAM need gradients or feature maps, so they run on the PyTorch checkpoint
  (loaded on first use); without PyTorch the API still predicts, explanations return 501.
"""

import os
import time
from pathlib import Path

import numpy as np
from PIL import Image

from src.utils.common import ROOT, load_json

MIN_CONFIDENCE = float(os.getenv("MIN_CONFIDENCE", "0.60"))
MIN_MARGIN = float(os.getenv("MIN_MARGIN", "0.10"))


def default_model_dir() -> Path:
    if os.getenv("MODEL_DIR"):
        return Path(os.environ["MODEL_DIR"])
    trained = ROOT / "models"
    return trained if (trained / "metadata.json").exists() else trained / "legacy"


def describe(class_id: str) -> dict:
    """'Tomato___Late_blight' -> plant 'Tomato', condition 'Late blight'."""
    plant, _, cond = class_id.partition("___")
    plant = plant.replace("_", " ").replace(",", "").strip()
    cond = cond.replace("_", " ").strip() or "unknown"
    return {"plant": plant, "condition": cond, "healthy": cond.lower() == "healthy"}


def is_uncertain(scores: list[float]) -> bool:
    best = scores[0]
    second = scores[1] if len(scores) > 1 else 0.0
    return best < MIN_CONFIDENCE or (best - second) < MIN_MARGIN


def softmax(z: np.ndarray) -> np.ndarray:
    e = np.exp(z - z.max(axis=-1, keepdims=True))
    return e / e.sum(axis=-1, keepdims=True)


class ModelService:
    engine = "onnxruntime"

    def __init__(self, model_dir: Path | None = None, variant: str | None = None):
        import onnxruntime as ort

        self.dir = Path(model_dir or default_model_dir())
        self.meta = load_json(self.dir / "metadata.json")
        self.classes: list[str] = self.meta["classes"]
        self.size = int(self.meta["img_size"])
        self.mean = np.array(self.meta["input"]["mean"], np.float32)
        self.std = np.array(self.meta["input"]["std"], np.float32)
        self.version = self.meta["version"]

        wanted = variant or os.getenv("ONNX_VARIANT") or self.meta.get("serve_variant", "fp32")
        info = self.meta.get("variants", {}).get(wanted, {})
        path = self.dir / info.get("file", "model.onnx")
        if not path.exists() or "error" in info:
            wanted, path = "fp32", self.dir / "model.onnx"
        self.variant = wanted

        available = ort.get_available_providers()
        self.providers = [p for p in ("CUDAExecutionProvider", "CPUExecutionProvider") if p in available]
        so = ort.SessionOptions()
        so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        so.intra_op_num_threads = int(os.getenv("ORT_THREADS", "0"))
        self.session = ort.InferenceSession(str(path), so, providers=self.providers)
        self.input_name = self.session.get_inputs()[0].name
        self._torch = None
        self._torch_error = None

    # ------------------------------------------------------------------ info
    def gpu(self) -> dict:
        used = self.session.get_providers()
        name = None
        if "CUDAExecutionProvider" in used:
            try:
                import torch

                name = torch.cuda.get_device_name(0)
            except Exception:  # noqa: BLE001
                name = "CUDA device"
        return {"available": "CUDAExecutionProvider" in used, "name": name, "providers": used}

    @property
    def explain_available(self) -> bool:
        return self._checkpoint() is not None and _torch_installed()

    def _checkpoint(self) -> Path | None:
        name = self.meta.get("checkpoint")
        for p in ([self.dir / name] if name else []) + [self.dir / "model.pt"] + sorted(self.dir.glob("*.pt")):
            if p.exists():
                return p
        return None

    # ------------------------------------------------------------------ inference
    def preprocess(self, image: Image.Image) -> np.ndarray:
        img = image.convert("RGB").resize((self.size, self.size), Image.BILINEAR)
        arr = (np.asarray(img, dtype=np.float32) / 255.0 - self.mean) / self.std
        return arr.transpose(2, 0, 1)[None].astype(np.float32)

    def predict(self, image: Image.Image, top_k: int = 3) -> dict:
        t0 = time.perf_counter()
        x = self.preprocess(image)
        t1 = time.perf_counter()
        probs = softmax(self.session.run(None, {self.input_name: x})[0][0])
        t2 = time.perf_counter()
        order = probs.argsort()[::-1][:top_k]
        return {
            "top_k": [{"class_id": self.classes[i], "score": round(float(probs[i]), 4)} for i in order],
            "preprocess_ms": (t1 - t0) * 1000,
            "inference_ms": (t2 - t1) * 1000,
        }

    # ------------------------------------------------------------------ explanations
    def _torch_model(self):
        if self._torch is None:
            ck = self._checkpoint()
            if ck is None or not _torch_installed():
                raise RuntimeError("Explanations need PyTorch and the training checkpoint (.pt) next to the ONNX model.")
            import torch

            from src.models.checkpoint import load_checkpoint

            torch.set_num_threads(int(os.getenv("TORCH_THREADS", "2")))
            self._torch, _ = load_checkpoint(ck)
        return self._torch

    def explain(self, image: Image.Image, method: str = "gradcam", class_id: str | None = None) -> np.ndarray:
        import torch

        from src.models.architecture import gradcam_layer
        from src.utils.gradcam import GradCAM, ScoreCAM

        model = self._torch_model()
        x = torch.from_numpy(self.preprocess(image))
        idx = self.classes.index(class_id) if class_id in self.classes else None
        engine = ScoreCAM(model, gradcam_layer(model)) if method == "scorecam" else GradCAM(model, gradcam_layer(model))
        cam, _, _ = engine(x, idx)
        return cam


def _torch_installed() -> bool:
    try:
        import torch  # noqa: F401

        return True
    except ImportError:
        return False


class MockService:
    """MOCK=1: random but well-formed answers, to develop the UI without any model."""

    engine = "mock"
    variant = None
    version = "mock"
    explain_available = False

    def __init__(self):
        cls = ROOT / "models" / "legacy" / "classes.json"
        self.classes = list(load_json(cls)) if cls.exists() else ["Tomato___healthy", "Tomato___Late_blight", "Potato___Early_blight"]
        self.meta = {
            "name": "mock",
            "architecture": "mock",
            "version": "mock",
            "task": "demo",
            "framework": "none",
            "num_classes": len(self.classes),
            "classes": self.classes,
            "img_size": 224,
            "input": {},
            "output": {},
            "metrics": {},
            "serve_variant": "none",
        }

    def gpu(self):
        return {"available": False, "name": None, "providers": []}

    def predict(self, image, top_k=3):
        rng = np.random.default_rng()
        idx = rng.choice(len(self.classes), size=min(top_k, len(self.classes)), replace=False)
        scores = np.sort(rng.dirichlet(np.ones(len(idx)) * 0.3))[::-1]
        time.sleep(0.05)
        return {
            "top_k": [{"class_id": self.classes[i], "score": round(float(s), 4)} for i, s in zip(idx, scores)],
            "preprocess_ms": 0.0,
            "inference_ms": 50.0,
        }

    def explain(self, *a, **k):
        raise RuntimeError("No explanation in mock mode.")
