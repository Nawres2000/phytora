"""Image descriptors logged for every prediction and used for data-drift detection.

They summarise what the camera sends (size, light, colour, focus, how much leaf is visible),
so a shift between training images and production photos (field photos, phone cameras,
night shots...) shows up without storing the images themselves. numpy / PIL only.
"""

import numpy as np
from PIL import Image

from src.utils.severity import masks

FEATURES = ["width", "height", "aspect_ratio", "brightness", "contrast", "saturation", "green_ratio", "sharpness", "leaf_coverage"]


def _laplacian_var(gray: np.ndarray) -> float:
    """Variance of a 4-neighbour Laplacian: low values = blurry image."""
    g = gray.astype(np.float32)
    lap = -4 * g[1:-1, 1:-1] + g[:-2, 1:-1] + g[2:, 1:-1] + g[1:-1, :-2] + g[1:-1, 2:]
    return float(lap.var())


def image_stats(image: Image.Image) -> dict:
    img = image.convert("RGB")
    width, height = img.size
    small = img.copy()
    small.thumbnail((256, 256))
    hsv = np.asarray(small.convert("HSV"), dtype=np.float32) / 255.0
    gray = np.asarray(small.convert("L"), dtype=np.float32)
    h, s = hsv[..., 0], hsv[..., 1]
    saturated = s > 0.18
    green = saturated & (h >= 35 / 360) & (h <= 170 / 360)
    _, leaf, _ = masks(small)
    return {
        "width": int(width),
        "height": int(height),
        "aspect_ratio": round(width / max(height, 1), 4),
        "brightness": round(float(gray.mean() / 255.0), 4),
        "contrast": round(float(gray.std() / 255.0), 4),
        "saturation": round(float(s.mean()), 4),
        "green_ratio": round(float(green.sum() / max(saturated.sum(), 1)), 4),
        "sharpness": round(_laplacian_var(gray), 2),
        "leaf_coverage": round(float(leaf.mean()), 4),
    }
