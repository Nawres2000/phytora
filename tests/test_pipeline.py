"""Unit tests of the training pipeline (CPU, no dataset needed)."""

import numpy as np
import pandas as pd
import pytest
import torch
from PIL import Image

from src.data.augment import cutmix, mix_batch, mixup
from src.data.dataset import build_transforms
from src.data.prepare import assert_no_leak, clean, dhash, group_split
from src.models.architecture import ARCHITECTURES, build_model, gradcam_layer
from src.models.losses import FocalLoss, build_criterion, class_weights
from src.utils.gradcam import GradCAM, ScoreCAM, overlay
from src.utils.severity import estimate_severity


def leaf_image(lesion_share=0.0, size=128):
    """Green disc on a grey background, with a brown square covering `lesion_share` of the disc."""
    img = np.full((size, size, 3), 200, np.uint8)
    yy, xx = np.mgrid[:size, :size]
    disc = (yy - size / 2) ** 2 + (xx - size / 2) ** 2 < (size * 0.4) ** 2
    img[disc] = (40, 150, 40)
    if lesion_share:
        side = int(np.sqrt(lesion_share * disc.sum()))
        c = size // 2
        img[c - side // 2 : c + side // 2, c - side // 2 : c + side // 2] = (120, 70, 20)
    return Image.fromarray(img)


@pytest.mark.parametrize("name", ARCHITECTURES)
def test_architectures_output_shape(name):
    if name in ("efficientnet_v2_s", "convnext_tiny"):
        pytest.importorskip("torchvision")
    model = build_model(name, 38).eval()
    with torch.no_grad():
        out = model(torch.randn(2, 3, 64 if name == "baseline_cnn" else 96, 64 if name == "baseline_cnn" else 96))
    assert out.shape == (2, 38)
    assert gradcam_layer(model) is not None


def test_focal_loss_equals_ce_when_gamma_zero():
    logits, y = torch.randn(8, 5), torch.randint(0, 5, (8,))
    ce = torch.nn.functional.cross_entropy(logits, y)
    assert torch.allclose(FocalLoss(gamma=0.0)(logits, y), ce, atol=1e-6)
    assert FocalLoss(gamma=2.0)(logits, y) < ce  # easy examples are down-weighted


def test_class_weights_balanced():
    w = class_weights([0, 0, 0, 1], 2)
    assert w[1] > w[0]
    assert isinstance(build_criterion("weighted_ce", w), torch.nn.CrossEntropyLoss)
    with pytest.raises(ValueError):
        build_criterion("nope", w)


def test_mixup_and_cutmix_keep_shapes():
    x, y = torch.randn(4, 3, 32, 32), torch.arange(4)
    for fn in (mixup, cutmix):
        xm, ya, yb, lam = fn(x, y, 0.4)
        assert xm.shape == x.shape and 0.0 <= lam <= 1.0 and torch.equal(ya, y)
    xm, ya, yb, lam = mix_batch(x, y, "none", 0.4, 1.0)
    assert lam == 1.0 and torch.equal(xm, x)


def test_transforms_output_size():
    img = leaf_image()
    assert build_transforms(64, train=True, randaugment=True)(img).shape == (3, 64, 64)
    assert build_transforms(64, train=False)(img).shape == (3, 64, 64)


def test_dhash_robust_to_resize():
    img = leaf_image(0.1, 256)
    assert dhash(img) == dhash(img.resize((128, 128)))


def test_split_is_leak_free_and_stratified():
    rows = []
    for c in range(3):
        for i in range(40):
            rows.append({"path": f"{c}/{i}.jpg", "label": f"c{c}", "md5": f"{c}-{i}", "dhash": f"{c}-{i // 2}"})  # pairs of near-dups
    rows.append({"path": "dup.jpg", "label": "c0", "md5": "0-0", "dhash": "0-0"})  # exact duplicate
    df, info = clean(pd.DataFrame(rows))
    assert info["exact_duplicates_removed"] == 1
    split, _ = group_split(df, 0.15, 0.15, 42, use_groups=True)
    assert_no_leak(split)
    assert set(split["split"]) == {"train", "val", "test"}
    assert (split.groupby("dhash")["split"].nunique() == 1).all()


def test_severity_increases_with_lesions():
    healthy = estimate_severity(leaf_image(0.0))
    sick = estimate_severity(leaf_image(0.3))
    assert healthy["percent"] < 3
    assert 20 < sick["percent"] < 40 and sick["level"] in ("élevée", "modérée")
    assert estimate_severity(Image.new("RGB", (64, 64), (200, 200, 200)))["percent"] is None


def test_gradcam_and_scorecam_maps():
    model = build_model("baseline_cnn", 4).eval()
    x = torch.randn(1, 3, 64, 64)
    for engine in (GradCAM(model, gradcam_layer(model)), ScoreCAM(model, gradcam_layer(model), n_maps=8)):
        cam, idx, probs = engine(x)
        assert cam.shape == (64, 64) and 0 <= cam.min() and cam.max() <= 1
        assert 0 <= idx < 4 and abs(probs.sum() - 1) < 1e-4
    assert overlay(leaf_image(), cam).size == (128, 128)
