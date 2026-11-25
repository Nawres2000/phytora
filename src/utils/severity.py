"""Disease severity estimate: share of the leaf surface that shows symptoms.

Colour heuristic (numpy only, no extra model), designed for one leaf on a plain background:
- leaf   = coloured pixels (saturation and brightness above a threshold), i.e. not the background;
- lesion = leaf pixels whose hue is outside the healthy green band (yellow / brown / black spots),
           or dark necrotic pixels.
severity % = lesion pixels / leaf pixels, mapped to 4 grades (inspired by the Horsfall-Barratt scale).

This is an ESTIMATE: shadows, reflections and naturally non-green leaves bias it.
"""

import numpy as np
from PIL import Image

GRADES = [(5, "faible"), (15, "modérée"), (35, "élevée"), (101, "sévère")]
HEALTHY_HUE = (35 / 360, 170 / 360)  # green band, hue in [0, 1]


def masks(image: Image.Image, size: int = 256):
    img = image.convert("RGB")
    img.thumbnail((size, size))
    hsv = np.asarray(img.convert("HSV"), dtype=np.float32) / 255.0
    h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    leaf = (s > 0.18) & (v > 0.15) & (v < 0.98)
    leaf |= (v < 0.25) & (s > 0.1)  # dark necrotic tissue is part of the leaf
    green = (h >= HEALTHY_HUE[0]) & (h <= HEALTHY_HUE[1]) & (v > 0.25)
    lesion = leaf & ~green
    return img, leaf, lesion


def estimate_severity(image: Image.Image) -> dict:
    _, leaf, lesion = masks(image)
    leaf_px = int(leaf.sum())
    if leaf_px < 0.03 * leaf.size:
        return {"percent": None, "level": "indéterminée", "leaf_coverage": round(leaf_px / leaf.size, 3)}
    pct = round(100.0 * lesion.sum() / leaf_px, 1)
    level = next(name for limit, name in GRADES if pct < limit)
    return {"percent": pct, "level": level, "leaf_coverage": round(leaf_px / leaf.size, 3)}


def severity_overlay(image: Image.Image) -> Image.Image:
    """Lesions in red, healthy leaf slightly highlighted, background dimmed."""
    img, leaf, lesion = masks(image)
    base = np.asarray(img, dtype=np.float32) / 255.0
    out = base * 0.35
    out[leaf] = base[leaf]
    out[lesion] = 0.4 * base[lesion] + 0.6 * np.array([1.0, 0.1, 0.1])
    return Image.fromarray((out * 255).astype(np.uint8))
