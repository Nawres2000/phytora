"""DVC stage `reference`: the reference profile production traffic is compared with.

A sample of VALIDATION images (never test) goes through the exported ONNX model exactly like
an API request; their image descriptors and predictions are saved to reports/monitoring/reference.csv.

Usage: python -m src.monitoring.reference [--model-dir models] [--images DIR]
"""

import argparse
from pathlib import Path

import numpy as np
import pandas as pd
from PIL import Image

from src.monitoring.features import image_stats
from src.utils.common import EXTENSIONS, ROOT, load_params, save_json


def sample_images(params, images_dir, n, seed):
    if images_dir:
        paths = [p for p in Path(images_dir).rglob("*") if p.suffix.lower() in EXTENSIONS]
    else:
        df = pd.read_csv(ROOT / params["data"]["processed_dir"] / "val.csv")
        raw = ROOT / params["data"]["raw_dir"]
        paths = [raw / p for p in df["path"]]
    rng = np.random.default_rng(seed)
    return [paths[i] for i in rng.choice(len(paths), size=min(n, len(paths)), replace=False)]


def build_reference(model_dir: Path, paths, out: Path) -> pd.DataFrame:
    from backend.app.inference import ModelService, is_uncertain

    service = ModelService(model_dir)
    rows = []
    for p in paths:
        img = Image.open(p).convert("RGB")
        top = service.predict(img, 2)["top_k"]
        rows.append(
            {
                **image_stats(img),
                "pred_class": top[0]["class_id"],
                "confidence": top[0]["score"],
                "uncertain": int(is_uncertain([c["score"] for c in top])),
            }
        )
    df = pd.DataFrame(rows)
    out.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(out, index=False)
    return df


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model-dir", default=str(ROOT / "models"))
    ap.add_argument("--images", help="folder of images instead of the DVC validation split")
    args = ap.parse_args()
    params = load_params()
    m = params["monitoring"]
    paths = sample_images(params, args.images, m["reference_images"], params["seed"])
    out = ROOT / "reports" / "monitoring" / "reference.csv"
    df = build_reference(Path(args.model_dir), paths, out)
    save_json(
        {
            "images": len(df),
            "mean_confidence": round(float(df["confidence"].mean()), 4),
            "uncertain_rate": round(float(df["uncertain"].mean()), 4),
        },
        ROOT / "reports" / "monitoring" / "reference.json",
    )
    print(f"reference profile: {len(df)} images -> {out}")


if __name__ == "__main__":
    main()
