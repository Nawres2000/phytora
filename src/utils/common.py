"""Small helpers shared by every stage: params, seeding, JSON, MLflow setup."""

import json
import os
import random
from pathlib import Path

import numpy as np
import yaml

ROOT = Path(__file__).resolve().parents[2]
IMAGENET_MEAN = [0.485, 0.456, 0.406]
IMAGENET_STD = [0.229, 0.224, 0.225]
EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp"}


def load_params(path: str | Path = ROOT / "params.yaml") -> dict:
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f)


def set_seed(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    try:
        import torch

        torch.manual_seed(seed)
        torch.cuda.manual_seed_all(seed)
    except ImportError:
        pass


def save_json(obj, path: str | Path) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=2, ensure_ascii=False)


def load_json(path: str | Path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def flatten(d: dict, prefix: str = "") -> dict:
    """{'train': {'lr': 1}} -> {'train.lr': 1} (MLflow params are flat)."""
    out = {}
    for k, v in d.items():
        key = f"{prefix}{k}"
        if isinstance(v, dict):
            out.update(flatten(v, key + "."))
        else:
            out[key] = v
    return out


def setup_mlflow(experiment: str):
    """Tracking URI from MLFLOW_TRACKING_URI (server, DagsHub...), else a local SQLite store."""
    import mlflow

    uri = os.getenv("MLFLOW_TRACKING_URI") or f"sqlite:///{ROOT / 'mlflow.db'}"
    mlflow.set_tracking_uri(uri)
    if mlflow.get_experiment_by_name(experiment) is None:
        artifacts = os.getenv("MLFLOW_ARTIFACT_LOCATION")
        if artifacts is None and uri.startswith("sqlite"):
            artifacts = (ROOT / "mlruns").as_uri()
        mlflow.create_experiment(experiment, artifact_location=artifacts)
    mlflow.set_experiment(experiment)
    return mlflow
