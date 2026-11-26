"""Production monitoring of the model API.

- Prometheus metrics on GET /metrics:
  * system: request count / latency / errors per route (+ process CPU, memory, open files from prometheus_client);
  * model: inference latency, predictions per class, confidence distribution, uncertain predictions,
    estimated severity, loaded model version, data-drift share read from the last drift check.
- Structured JSON log of every prediction (stdout + logs/predictions.jsonl): what the drift job reads.
"""

import json
import logging
import os
import sys
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

from prometheus_client import CONTENT_TYPE_LATEST, Counter, Gauge, Histogram, Info, generate_latest

from src.utils.common import ROOT

LOG_PATH = Path(os.getenv("PREDICTION_LOG", ROOT / "logs" / "predictions.jsonl"))
DRIFT_SUMMARY = Path(os.getenv("DRIFT_SUMMARY", ROOT / "reports" / "monitoring" / "drift_summary.json"))

# ---------------------------------------------------------------- metrics
REQUESTS = Counter("phytora_http_requests_total", "HTTP requests", ["method", "route", "status"])
LATENCY = Histogram(
    "phytora_http_request_duration_seconds",
    "HTTP request duration",
    ["route"],
    buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5),
)
INFERENCE = Histogram(
    "phytora_inference_duration_seconds",
    "Model forward pass duration (ONNX Runtime)",
    buckets=(0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25),
)
PREDICTIONS = Counter("phytora_predictions_total", "Predictions per predicted class", ["class_id", "healthy"])
CONFIDENCE = Histogram(
    "phytora_prediction_confidence", "Top-1 confidence of the predictions", buckets=(0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.99, 1.0)
)
UNCERTAIN = Counter("phytora_uncertain_predictions_total", "Predictions flagged uncertain")
SEVERITY = Histogram("phytora_severity_percent", "Estimated diseased leaf surface (%)", buckets=(1, 5, 10, 15, 25, 35, 50, 75, 100))
MODEL_INFO = Info("phytora_model", "Loaded model")
MODEL_LOADED = Gauge("phytora_model_loaded", "1 if a model is loaded")
DRIFT_SHARE = Gauge("phytora_data_drift_share", "Share of monitored columns drifting (last drift check)")
DRIFT_DETECTED = Gauge("phytora_drift_detected", "1 if the last drift check found data or prediction drift")
DRIFT_AGE = Gauge("phytora_drift_check_age_seconds", "Seconds since the last drift check")
CURRENT_CONFIDENCE = Gauge("phytora_drift_current_mean_confidence", "Mean confidence of the monitored window")

# ---------------------------------------------------------------- structured logging
logger = logging.getLogger("phytora.predictions")
if not logger.handlers:
    _h = logging.StreamHandler(sys.stdout)
    _h.setFormatter(logging.Formatter("%(message)s"))
    logger.addHandler(_h)
    logger.setLevel(logging.INFO)
    logger.propagate = False
_lock = threading.Lock()


def log_event(event: dict) -> None:
    """One JSON line per event on stdout (collected by `docker logs`) and in the prediction log file."""
    record = {"ts": datetime.now(timezone.utc).isoformat(timespec="milliseconds"), **event}
    line = json.dumps(record, ensure_ascii=False)
    logger.info(line)
    if event.get("event") != "prediction":
        return
    try:
        LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with _lock, open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except OSError as e:  # read-only volume: keep serving, metrics still work
        logger.info(json.dumps({"event": "log_write_error", "error": str(e)}))


def record_prediction(result: dict, stats: dict, route: str) -> None:
    INFERENCE.observe(result["latency"]["inference_ms"] / 1000)
    PREDICTIONS.labels(result["class_id"], str(result["top_k"][0]["healthy"]).lower()).inc()
    CONFIDENCE.observe(result["confidence"])
    if result["uncertain"]:
        UNCERTAIN.inc()
    if result.get("severity") and result["severity"].get("percent") is not None:
        SEVERITY.observe(result["severity"]["percent"])
    top = result["top_k"]
    log_event(
        {
            "event": "prediction",
            "request_id": uuid.uuid4().hex[:12],
            "route": route,
            "model_version": result["model_version"],
            "variant": result["variant"],
            "mock": result["mock"],
            "pred_class": result["class_id"],
            "confidence": result["confidence"],
            "margin": round(top[0]["score"] - (top[1]["score"] if len(top) > 1 else 0.0), 4),
            "uncertain": int(result["uncertain"]),
            "severity": (result.get("severity") or {}).get("percent"),
            "latency_ms": result["latency_ms"],
            "inference_ms": result["latency"]["inference_ms"],
            **stats,
        }
    )


def set_model(service) -> None:
    MODEL_LOADED.set(1 if service else 0)
    if service:
        MODEL_INFO.info({"version": str(service.version), "engine": str(service.engine), "variant": str(service.variant)})


def refresh_drift() -> None:
    try:
        s = json.loads(DRIFT_SUMMARY.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return
    DRIFT_SHARE.set(s.get("drift_share", 0.0))
    DRIFT_DETECTED.set(1 if s.get("status") == "drift" else 0)
    if s.get("mean_confidence"):
        CURRENT_CONFIDENCE.set(s["mean_confidence"]["current"])
    try:
        DRIFT_AGE.set(time.time() - datetime.fromisoformat(s["checked_at"]).timestamp())
    except (KeyError, ValueError):
        pass


def metrics_payload() -> tuple[bytes, str]:
    refresh_drift()
    return generate_latest(), CONTENT_TYPE_LATEST
