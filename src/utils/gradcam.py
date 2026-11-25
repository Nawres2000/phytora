"""Explainability: Grad-CAM and Score-CAM (torch), plus image overlays (numpy / PIL only).

Grad-CAM (Selvaraju et al., 2017): weights = spatial mean of d(class score)/d(activations).
Score-CAM (Wang et al., 2020): gradient-free; each activation map masks the input and the
class probability it keeps becomes its weight. Slower (one forward per map), so only the
`n_maps` most active maps are used.
"""

import base64
import io

import numpy as np
from PIL import Image


class GradCAM:
    def __init__(self, model, target_layer):
        self.model = model.eval()
        self.target_layer = target_layer

    def __call__(self, x, class_idx: int | None = None):
        import torch

        store = {}

        def hook(_module, _inputs, output):
            store["acts"] = output
            output.register_hook(lambda g: store.__setitem__("grads", g))  # tensor hook: safe with in-place ops

        handle = self.target_layer.register_forward_hook(hook)
        try:
            with torch.enable_grad():
                x = x.clone().requires_grad_(True)
                logits = self.model(x)
                probs = torch.softmax(logits.detach(), 1)[0]
                if class_idx is None:
                    class_idx = int(probs.argmax())
                self.model.zero_grad(set_to_none=True)
                logits[0, class_idx].backward()
        finally:
            handle.remove()
        acts, grads = store["acts"].detach(), store["grads"].detach()
        cam = torch.relu((grads.mean(dim=(2, 3), keepdim=True) * acts).sum(1, keepdim=True))
        cam = torch.nn.functional.interpolate(cam, size=x.shape[-2:], mode="bilinear", align_corners=False)[0, 0]
        return normalize(cam.numpy()), class_idx, probs.numpy()


class ScoreCAM:
    def __init__(self, model, target_layer, n_maps: int = 32, batch_size: int = 16):
        self.model, self.target_layer = model.eval(), target_layer
        self.n_maps, self.batch_size = n_maps, batch_size

    def __call__(self, x, class_idx: int | None = None):
        import torch
        import torch.nn.functional as F

        store = {}
        handle = self.target_layer.register_forward_hook(lambda m, i, o: store.__setitem__("acts", o.detach()))
        try:
            with torch.inference_mode():
                probs = torch.softmax(self.model(x), 1)[0]
        finally:
            handle.remove()
        if class_idx is None:
            class_idx = int(probs.argmax())
        acts = store["acts"][0]
        top = acts.mean(dim=(1, 2)).topk(min(self.n_maps, acts.shape[0])).indices
        maps = F.interpolate(acts[top][:, None], size=x.shape[-2:], mode="bilinear", align_corners=False)
        mn = maps.amin(dim=(2, 3), keepdim=True)
        mx = maps.amax(dim=(2, 3), keepdim=True)
        maps = (maps - mn) / (mx - mn + 1e-8)
        scores = []
        with torch.inference_mode():
            for i in range(0, len(maps), self.batch_size):
                m = maps[i : i + self.batch_size]
                scores.append(torch.softmax(self.model(x * m), 1)[:, class_idx])
        w = torch.softmax(torch.cat(scores), 0)
        cam = torch.relu((w[:, None, None] * maps[:, 0]).sum(0))
        return normalize(cam.numpy()), class_idx, probs.numpy()


def normalize(cam: np.ndarray) -> np.ndarray:
    return (cam - cam.min()) / (cam.max() - cam.min() + 1e-8)


def jet(v: np.ndarray) -> np.ndarray:
    r = np.clip(1.5 - np.abs(4 * v - 3), 0, 1)
    g = np.clip(1.5 - np.abs(4 * v - 2), 0, 1)
    b = np.clip(1.5 - np.abs(4 * v - 1), 0, 1)
    return np.stack([r, g, b], axis=-1)


def overlay(img: Image.Image, cam: np.ndarray, alpha: float = 0.45) -> Image.Image:
    """Blend a 0..1 heat map over the image (the map is resized to the image)."""
    img = img.convert("RGB")
    if cam.shape != (img.height, img.width):
        cam = np.asarray(Image.fromarray((cam * 255).astype(np.uint8)).resize(img.size, Image.BILINEAR), dtype=np.float32) / 255
    base = np.asarray(img, dtype=np.float32) / 255.0
    return Image.fromarray((np.clip((1 - alpha) * base + alpha * jet(cam), 0, 1) * 255).astype(np.uint8))


def to_data_url(img: Image.Image, fmt: str = "JPEG", quality: int = 80) -> str:
    buf = io.BytesIO()
    img.save(buf, fmt, quality=quality)
    return f"data:image/{fmt.lower()};base64," + base64.b64encode(buf.getvalue()).decode()


def to_bytes(img: Image.Image, fmt: str = "PNG") -> bytes:
    buf = io.BytesIO()
    img.save(buf, fmt)
    return buf.getvalue()
