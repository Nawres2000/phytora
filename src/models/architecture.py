"""Network definitions. Every model exposes `.features` (backbone blocks) and a classification head,
so the training phases (freeze / unfreeze the last blocks) and Grad-CAM work the same way for all.

- baseline_cnn       : small 4-block CNN trained from scratch (the reference to beat)
- mobilenet_v3_small : ImageNet-pretrained, 2.5 M params, fast on CPU (served model)
- efficientnet_v2_s  : ImageNet-pretrained, 21 M params, stronger but slower
- convnext_tiny      : ImageNet-pretrained, 28 M params, modern "CNN designed like a ViT"
"""

import torch.nn as nn
from torchvision import models

ARCHITECTURES = ("baseline_cnn", "mobilenet_v3_small", "efficientnet_v2_s", "convnext_tiny")


class BaselineCNN(nn.Sequential):
    """Same layer order as the training notebook, so old checkpoints still load."""

    def __init__(self, num_classes: int):
        def block(i, o):
            return nn.Sequential(nn.Conv2d(i, o, 3, padding=1), nn.BatchNorm2d(o), nn.ReLU(inplace=True), nn.MaxPool2d(2))

        super().__init__(
            block(3, 32),
            block(32, 64),
            block(64, 128),
            block(128, 128),
            nn.AdaptiveAvgPool2d(1),
            nn.Flatten(),
            nn.Dropout(0.3),
            nn.Linear(128, num_classes),
        )

    # plain Sequential views sharing the same modules (slicing self would call BaselineCNN(OrderedDict))
    @property
    def features(self):
        return nn.Sequential(*list(self)[:4])

    @property
    def classifier(self):
        return nn.Sequential(*list(self)[4:])


def build_model(name: str, num_classes: int, pretrained: bool = False) -> nn.Module:
    if name == "baseline_cnn":
        return BaselineCNN(num_classes)
    if name == "mobilenet_v3_small":
        m = models.mobilenet_v3_small(weights=models.MobileNet_V3_Small_Weights.DEFAULT if pretrained else None)
    elif name == "efficientnet_v2_s":
        m = models.efficientnet_v2_s(weights=models.EfficientNet_V2_S_Weights.DEFAULT if pretrained else None)
    elif name == "convnext_tiny":
        m = models.convnext_tiny(weights=models.ConvNeXt_Tiny_Weights.DEFAULT if pretrained else None)
    else:
        raise ValueError(f"Unknown architecture {name!r}, choose from {ARCHITECTURES}")
    m.classifier[-1] = nn.Linear(m.classifier[-1].in_features, num_classes)
    return m


def gradcam_layer(model: nn.Module) -> nn.Module:
    """Last convolutional block: the usual Grad-CAM target."""
    return model.features[-1]


def count_params(model: nn.Module) -> int:
    return sum(p.numel() for p in model.parameters())
