"""Batch-level augmentations: MixUp and CutMix (applied inside the training loop)."""

import numpy as np
import torch


def mixup(x: torch.Tensor, y: torch.Tensor, alpha: float):
    lam = float(np.random.beta(alpha, alpha))
    idx = torch.randperm(x.size(0), device=x.device)
    return lam * x + (1 - lam) * x[idx], y, y[idx], lam


def cutmix(x: torch.Tensor, y: torch.Tensor, alpha: float):
    lam = float(np.random.beta(alpha, alpha))
    idx = torch.randperm(x.size(0), device=x.device)
    h, w = x.shape[-2:]
    cut = np.sqrt(1 - lam)
    ch, cw = int(h * cut), int(w * cut)
    cy, cx = np.random.randint(h), np.random.randint(w)
    y1, y2 = np.clip(cy - ch // 2, 0, h), np.clip(cy + ch // 2, 0, h)
    x1, x2 = np.clip(cx - cw // 2, 0, w), np.clip(cx + cw // 2, 0, w)
    x = x.clone()
    x[:, :, y1:y2, x1:x2] = x[idx, :, y1:y2, x1:x2]
    lam = 1 - ((y2 - y1) * (x2 - x1) / (h * w))  # exact area actually pasted
    return x, y, y[idx], float(lam)


def mix_batch(x, y, mode: str, alpha: float, prob: float):
    """Returns (x, y_a, y_b, lam). With mode 'none' or when not drawn: lam = 1 (plain batch)."""
    if mode == "none" or np.random.rand() > prob:
        return x, y, y, 1.0
    if mode == "both":
        mode = "mixup" if np.random.rand() < 0.5 else "cutmix"
    return (mixup if mode == "mixup" else cutmix)(x, y, alpha)
