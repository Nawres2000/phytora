"""PyTorch Dataset, transforms and DataLoaders.

Augmentations are applied to train only. Normalisation uses fixed ImageNet statistics
(the pretrained backbones expect them), so no statistic is fitted on val/test.
Eval preprocessing = what the API does: RGB -> bilinear resize -> /255 -> (x - mean) / std.
"""

from pathlib import Path

import pandas as pd
from PIL import Image
from torch.utils.data import DataLoader, Dataset
from torchvision import transforms

from src.utils.common import IMAGENET_MEAN, IMAGENET_STD


def build_transforms(img_size: int, train: bool, randaugment: bool = False):
    if not train:
        return transforms.Compose(
            [
                transforms.Resize((img_size, img_size)),
                transforms.ToTensor(),
                transforms.Normalize(IMAGENET_MEAN, IMAGENET_STD),
            ]
        )
    ops = [
        transforms.RandomResizedCrop(img_size, scale=(0.7, 1.0)),
        transforms.RandomHorizontalFlip(),
        transforms.RandomRotation(20),
    ]
    # RandAugment replaces the hand-tuned colour jitter (it samples its own colour/geometric ops)
    ops.append(
        transforms.RandAugment(num_ops=2, magnitude=9)
        if randaugment
        else transforms.ColorJitter(brightness=0.3, contrast=0.3, saturation=0.2)
    )
    ops += [transforms.ToTensor(), transforms.Normalize(IMAGENET_MEAN, IMAGENET_STD)]
    return transforms.Compose(ops)


class PlantVillageDataset(Dataset):
    def __init__(self, frame: pd.DataFrame, root: str | Path, transform=None):
        self.paths = [Path(root) / p for p in frame["path"]]
        self.labels = frame["class_idx"].astype(int).tolist()
        self.transform = transform

    def __len__(self):
        return len(self.labels)

    def __getitem__(self, i):
        image = Image.open(self.paths[i]).convert("RGB")
        return (self.transform(image) if self.transform else image), self.labels[i]


def make_loader(frame, root, transform, batch_size, shuffle, num_workers, pin_memory=False):
    return DataLoader(
        PlantVillageDataset(frame, root, transform),
        batch_size=batch_size,
        shuffle=shuffle,
        num_workers=num_workers,
        pin_memory=pin_memory,
        persistent_workers=num_workers > 0,
    )
