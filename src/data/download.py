"""Download PlantVillage (Kaggle abdallahalidev/plantvillage-dataset) into data/raw/plantvillage.

Needs Kaggle credentials (~/.kaggle/kaggle.json or KAGGLE_USERNAME / KAGGLE_KEY).
Then version the raw data with DVC (never with Git):
    dvc add data/raw/plantvillage && git add data/raw/plantvillage.dvc data/raw/.gitignore
    dvc push
"""

import shutil
from pathlib import Path

from src.utils.common import ROOT

DATASET = "abdallahalidev/plantvillage-dataset"


def main():
    import kagglehub  # pip install kagglehub

    src = Path(kagglehub.dataset_download(DATASET))
    color = next((p for p in src.rglob("color") if p.is_dir()), None)
    if color is None:
        raise SystemExit(f"'color' folder not found in {src}")
    dst = ROOT / "data" / "raw" / "plantvillage" / "color"
    if dst.exists():
        print("Already present:", dst)
        return
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(color, dst)
    print("Copied to", dst)


if __name__ == "__main__":
    main()
