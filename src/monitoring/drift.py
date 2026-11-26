"""Data / prediction drift detection with Evidently: production window vs reference profile.

Inputs
- reference: reports/monitoring/reference.csv (DVC stage `reference`, validation images)
- current:   the last `monitoring.window_size` predictions logged by the API (logs/predictions.jsonl)

Checks
- data drift on the image descriptors (K-S test per numeric column, chi-square on the predicted class);
- prediction drift: mean confidence drop and uncertain-rate increase vs reference (concept-drift proxies,
  since true labels arrive late, through the "diagnostic correct ?" feedback).

Outputs: reports/monitoring/drift_report.html (Evidently), drift_summary.json (read by the API and
exported to Prometheus), drift_history.jsonl (one line per check).

Usage: python -m src.monitoring.drift [--log logs/predictions.jsonl]
"""

import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from src.monitoring.features import FEATURES
from src.utils.common import ROOT, load_params, save_json

MON_DIR = ROOT / "reports" / "monitoring"
DEFAULT_LOG = Path(os.getenv("PREDICTION_LOG", ROOT / "logs" / "predictions.jsonl"))


def load_predictions(path: Path, window: int) -> pd.DataFrame:
    if not path.exists():
        return pd.DataFrame()
    rows = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue  # a partially written line must not break monitoring
    df = pd.DataFrame(rows[-window:])
    if df.empty:
        return df
    df = df[df.get("mock", False) != True]  # noqa: E712  (demo predictions are not production traffic)
    return df


def detect_drift(reference: pd.DataFrame, current: pd.DataFrame, cfg: dict, html_path: Path | None = None) -> dict:
    """Pure function (tested): returns the drift summary and optionally writes the Evidently HTML report."""
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    base = {"checked_at": now, "n_reference": int(len(reference)), "n_current": int(len(current))}
    if len(current) < cfg["min_samples"]:
        return {
            **base,
            "status": "insufficient_data",
            "dataset_drift": False,
            "drift_share": 0.0,
            "drifted_columns": [],
            "message": f"{len(current)} predictions logged, {cfg['min_samples']} needed",
        }

    from evidently import DataDefinition, Dataset, Report
    from evidently.presets import DataDriftPreset

    numeric = [c for c in FEATURES + ["confidence"] if c in reference and c in current]
    categorical = [c for c in ["pred_class"] if c in reference and c in current]
    cols = numeric + categorical
    definition = DataDefinition(numerical_columns=numeric, categorical_columns=categorical)
    report = Report([DataDriftPreset(drift_share=cfg["drift_share"])])
    snapshot = report.run(
        Dataset.from_pandas(current[cols].copy(), data_definition=definition),
        Dataset.from_pandas(reference[cols].copy(), data_definition=definition),
    )
    if html_path:
        html_path.parent.mkdir(parents=True, exist_ok=True)
        snapshot.save_html(str(html_path))

    columns, share = {}, 0.0
    for m in snapshot.dict()["metrics"]:
        conf = m.get("config", {})
        if conf.get("type", "").endswith("DriftedColumnsCount"):
            share = float(m["value"]["share"])
        elif conf.get("type", "").endswith("ValueDrift"):
            p = float(m["value"])
            columns[conf["column"]] = {"p_value": round(p, 6), "method": conf.get("method"), "drifted": p < conf.get("threshold", 0.05)}

    ref_conf, cur_conf = float(reference["confidence"].mean()), float(current["confidence"].mean())
    ref_unc = float(reference["uncertain"].mean()) if "uncertain" in reference else 0.0
    cur_unc = float(current["uncertain"].astype(float).mean()) if "uncertain" in current else 0.0
    confidence_drop = ref_conf - cur_conf
    prediction_drift = confidence_drop > cfg["max_confidence_drop"] or (cur_unc - ref_unc) > cfg["max_uncertain_increase"]
    dataset_drift = share >= cfg["drift_share"]
    return {
        **base,
        "status": "drift" if (dataset_drift or prediction_drift) else "ok",
        "dataset_drift": bool(dataset_drift),
        "prediction_drift": bool(prediction_drift),
        "drift_share": round(share, 4),
        "drifted_columns": [c for c, v in columns.items() if v["drifted"]],
        "columns": columns,
        "mean_confidence": {"reference": round(ref_conf, 4), "current": round(cur_conf, 4)},
        "uncertain_rate": {"reference": round(ref_unc, 4), "current": round(cur_unc, 4)},
    }


def run(log_path: Path = DEFAULT_LOG) -> dict:
    cfg = load_params()["monitoring"]
    ref_path = MON_DIR / "reference.csv"
    if not ref_path.exists():
        raise FileNotFoundError(f"{ref_path} missing: run `dvc repro reference` first")
    summary = detect_drift(pd.read_csv(ref_path), load_predictions(log_path, cfg["window_size"]), cfg, MON_DIR / "drift_report.html")
    save_json(summary, MON_DIR / "drift_summary.json")
    with open(MON_DIR / "drift_history.jsonl", "a", encoding="utf-8") as f:
        f.write(json.dumps({k: summary[k] for k in ("checked_at", "status", "drift_share", "n_current", "drifted_columns")}) + "\n")
    return summary


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--log", default=str(DEFAULT_LOG))
    s = run(Path(ap.parse_args().log))
    print(json.dumps({k: v for k, v in s.items() if k != "columns"}, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
