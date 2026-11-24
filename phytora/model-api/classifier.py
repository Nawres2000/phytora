"""PHYTORA leaf-disease classifier: MobileNetV3-Small fine-tuned on PlantVillage (38 classes).

Preprocessing is identical to training (eval_transform in the training notebook):
RGB -> bilinear resize to img_size x img_size -> /255 -> ImageNet mean/std normalisation.
"""
import os
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from PIL import Image
from torchvision import models

from viz import overlay_data_url

MODEL_PATH = Path(os.getenv("MODEL_PATH", Path(__file__).parent / "models" / "mobilenet_v3_small_best.pt"))
torch.set_num_threads(int(os.getenv("TORCH_THREADS", "2")))


class DiseaseClassifier:
    def __init__(self, path: Path = MODEL_PATH):
        ck = torch.load(path, map_location="cpu", weights_only=True)
        self.classes: list[str] = list(ck["classes"])
        self.size = int(ck["img_size"])
        self.mean = torch.tensor(ck["mean"]).view(1, 3, 1, 1)
        self.std = torch.tensor(ck["std"]).view(1, 3, 1, 1)
        net = models.mobilenet_v3_small(weights=None)
        net.classifier[-1] = nn.Linear(net.classifier[-1].in_features, len(self.classes))
        net.load_state_dict(ck["state_dict"])
        self.net = net.eval()
        self.version = f"{ck['model']}-ep{ck.get('epoch', '?')}-valF1-{ck.get('best_val_macro_f1', 0):.3f}"

    def _prepare(self, image: Image.Image):
        small = image.convert("RGB").resize((self.size, self.size), Image.BILINEAR)
        x = torch.from_numpy(np.array(small, dtype=np.float32) / 255.0).permute(2, 0, 1).unsqueeze(0)
        return (x - self.mean) / self.std, small

    def predict(self, image: Image.Image, top_k: int = 3, explain: bool = True) -> dict:
        x, small = self._prepare(image)
        cam = None
        if explain:
            # Grad-CAM on the last conv block (same method as the part-2 notebook)
            with torch.enable_grad():
                feats = self.net.features(x)
                logits = self.net.classifier(torch.flatten(self.net.avgpool(feats), 1))
                probs = torch.softmax(logits.detach(), 1)[0]
                grads = torch.autograd.grad(logits[0, int(probs.argmax())], feats)[0]
            weights = grads.mean(dim=(2, 3), keepdim=True)
            cam_t = torch.relu((weights * feats.detach()).sum(dim=1, keepdim=True))
            cam_t = torch.nn.functional.interpolate(cam_t, size=(self.size, self.size), mode="bilinear", align_corners=False)[0, 0]
            cam = ((cam_t - cam_t.min()) / (cam_t.max() - cam_t.min() + 1e-8)).numpy()
        else:
            with torch.inference_mode():
                probs = torch.softmax(self.net(x), 1)[0]
        top = probs.topk(min(top_k, len(self.classes)))
        return {
            "top_k": [{"class_id": self.classes[int(i)], "score": round(float(p), 4)} for p, i in zip(top.values, top.indices)],
            "heatmap": overlay_data_url(small, cam) if cam is not None else None,
        }
