"""Load a training checkpoint (models/model.pt or a legacy notebook checkpoint) into an eval-mode network."""

from pathlib import Path

import torch

from src.models.architecture import build_model


def load_checkpoint(path: str | Path, device: str = "cpu"):
    ck = torch.load(path, map_location=device, weights_only=True)
    model = build_model(ck["model"], len(ck["classes"]), pretrained=False)
    model.load_state_dict(ck["state_dict"])
    meta = {k: v for k, v in ck.items() if k != "state_dict"}
    meta["classes"] = list(ck["classes"])
    return model.eval().to(device), meta
