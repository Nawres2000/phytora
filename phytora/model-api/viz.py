"""Heatmap overlay helpers (no torch needed)."""
import base64
import io

import numpy as np
from PIL import Image


def _jet(v: np.ndarray) -> np.ndarray:
    r = np.clip(1.5 - np.abs(4 * v - 3), 0, 1)
    g = np.clip(1.5 - np.abs(4 * v - 2), 0, 1)
    b = np.clip(1.5 - np.abs(4 * v - 1), 0, 1)
    return np.stack([r, g, b], axis=-1)


def overlay_data_url(img: Image.Image, cam: np.ndarray, alpha: float = 0.45, quality: int = 80) -> str:
    """Blend a Grad-CAM map (values 0..1, same size as img) over the image, return a JPEG data URL."""
    base = np.asarray(img.convert("RGB"), dtype=np.float32) / 255.0
    out = np.clip((1 - alpha) * base + alpha * _jet(cam), 0, 1)
    buf = io.BytesIO()
    Image.fromarray((out * 255).astype(np.uint8)).save(buf, "JPEG", quality=quality)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()
