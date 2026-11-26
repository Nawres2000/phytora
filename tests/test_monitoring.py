"""Monitoring: image descriptors and Evidently drift detection on synthetic data."""

import numpy as np
import pandas as pd
import pytest
from PIL import Image

from src.monitoring.drift import detect_drift, load_predictions
from src.monitoring.features import FEATURES, image_stats

CFG = {"min_samples": 30, "drift_share": 0.3, "max_confidence_drop": 0.10, "max_uncertain_increase": 0.15}


def frame(n, rng, brightness=0.5, confidence=0.9, classes=("a", "b", "c")):
    data = {f: rng.normal(0.5, 0.05, n) for f in FEATURES}
    data["brightness"] = rng.normal(brightness, 0.05, n)
    data["confidence"] = np.clip(rng.normal(confidence, 0.03, n), 0, 1)
    data["uncertain"] = (data["confidence"] < 0.6).astype(int)
    data["pred_class"] = rng.choice(classes, n)
    return pd.DataFrame(data)


def test_image_stats_keys_and_ranges():
    img = Image.fromarray(np.full((120, 200, 3), (40, 150, 40), np.uint8))
    s = image_stats(img)
    assert set(FEATURES) <= set(s)
    assert s["width"] == 200 and s["height"] == 120 and 0 <= s["brightness"] <= 1
    assert s["green_ratio"] > 0.9 and s["sharpness"] < 1  # uniform green image: very green, no edges


def test_insufficient_data():
    rng = np.random.default_rng(0)
    out = detect_drift(frame(200, rng), frame(5, rng), CFG)
    assert out["status"] == "insufficient_data" and out["dataset_drift"] is False


def test_no_drift_on_same_distribution():
    rng = np.random.default_rng(1)
    out = detect_drift(frame(400, rng), frame(200, rng), CFG)
    assert out["status"] == "ok" and out["drift_share"] < CFG["drift_share"]


def test_drift_detected_on_dark_images_and_low_confidence(tmp_path):
    rng = np.random.default_rng(2)
    ref = frame(400, rng)
    cur = frame(200, rng, brightness=0.2, confidence=0.65, classes=("a",))
    out = detect_drift(ref, cur, CFG, tmp_path / "report.html")
    assert out["status"] == "drift" and out["prediction_drift"]
    assert {"brightness", "confidence", "pred_class"} <= set(out["drifted_columns"])
    assert (tmp_path / "report.html").stat().st_size > 1000


def test_load_predictions_skips_bad_lines_and_mock(tmp_path):
    p = tmp_path / "log.jsonl"
    p.write_text('{"confidence": 0.9, "mock": false}\nnot json\n{"confidence": 0.1, "mock": true}\n')
    df = load_predictions(p, 100)
    assert len(df) == 1 and df["confidence"].iloc[0] == 0.9
    assert load_predictions(tmp_path / "missing.jsonl", 10).empty


if __name__ == "__main__":
    pytest.main([__file__])
