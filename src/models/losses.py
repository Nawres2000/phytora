"""Losses for an imbalanced 38-class problem (largest/smallest class ratio is about 35:1)."""

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from sklearn.utils.class_weight import compute_class_weight


class FocalLoss(nn.Module):
    """FL = -alpha_t (1 - p_t)^gamma log(p_t) (Lin et al., 2017): down-weights easy examples."""

    def __init__(self, gamma: float = 2.0, weight: torch.Tensor | None = None, label_smoothing: float = 0.0):
        super().__init__()
        self.gamma, self.label_smoothing = gamma, label_smoothing
        self.register_buffer("weight", weight if weight is not None else None)

    def forward(self, logits, target):
        ce = F.cross_entropy(logits, target, weight=self.weight, reduction="none", label_smoothing=self.label_smoothing)
        pt = torch.softmax(logits, 1).gather(1, target[:, None]).squeeze(1)
        return ((1 - pt) ** self.gamma * ce).mean()


def class_weights(labels, num_classes: int) -> torch.Tensor:
    """'balanced' weights computed on TRAIN labels only."""
    w = compute_class_weight("balanced", classes=np.arange(num_classes), y=np.asarray(labels))
    return torch.tensor(w, dtype=torch.float32)


def build_criterion(name: str, weights: torch.Tensor | None, gamma: float = 2.0, label_smoothing: float = 0.0):
    if name == "ce":
        return nn.CrossEntropyLoss(label_smoothing=label_smoothing)
    if name == "weighted_ce":
        return nn.CrossEntropyLoss(weight=weights, label_smoothing=label_smoothing)
    if name == "focal":
        return FocalLoss(gamma=gamma, weight=weights, label_smoothing=label_smoothing)
    raise ValueError(f"Unknown loss {name!r}")
