"""Stage `prepare`: inventory -> integrity check -> de-duplication -> leak-free stratified split.

Order matters to avoid data leakage:
1. read every image (integrity check + MD5 of the bytes + dHash of the pixels);
2. drop contents with contradictory labels, then exact duplicates (same MD5);
3. group near-duplicates (same dHash: re-encoded / resized copies) so a group never spans two splits;
4. only then split 70/15/15, stratified by class, at the group level;
5. assert that no MD5 and no dHash group is shared by two splits.

No statistic is computed on the data here (normalisation uses fixed ImageNet values),
so nothing from val/test can leak into training.

Usage: python -m src.data.prepare [--raw-dir DIR]
"""

import argparse
import hashlib
from pathlib import Path

import numpy as np
import pandas as pd
from PIL import Image
from sklearn.model_selection import train_test_split

from src.utils.common import EXTENSIONS, ROOT, load_params, save_json, set_seed


def md5_file(path: Path, chunk: int = 1 << 20) -> str:
    h = hashlib.md5()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(chunk), b""):
            h.update(block)
    return h.hexdigest()


def dhash(image: Image.Image, size: int = 8) -> str:
    """Difference hash: robust to re-encoding and resizing, 64 bits as hex."""
    g = np.asarray(image.convert("L").resize((size + 1, size), Image.BILINEAR), dtype=np.int16)
    bits = (g[:, 1:] > g[:, :-1]).flatten()
    return f"{int(''.join('1' if b else '0' for b in bits), 2):016x}"


def scan_images(raw_dir: Path) -> tuple[pd.DataFrame, list[str]]:
    records, corrupt = [], []
    for class_dir in sorted(d for d in raw_dir.iterdir() if d.is_dir()):
        for p in sorted(class_dir.iterdir()):
            if not (p.is_file() and p.suffix.lower() in EXTENSIONS):
                continue
            try:
                with Image.open(p) as im:
                    im.verify()
                with Image.open(p) as im:
                    h = dhash(im)
            except Exception:
                corrupt.append(str(p))
                continue
            records.append({"path": str(p.relative_to(raw_dir)), "label": class_dir.name, "md5": md5_file(p), "dhash": h})
    return pd.DataFrame(records), corrupt


def clean(df: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    labels_per_hash = df.groupby("md5")["label"].nunique()
    conflicts = set(labels_per_hash[labels_per_hash > 1].index)
    n_conflicts = int(df["md5"].isin(conflicts).sum())
    df = df[~df["md5"].isin(conflicts)]
    n_before = len(df)
    df = df.drop_duplicates(subset="md5", keep="first").reset_index(drop=True)
    return df, {"contradictory_labels_removed": n_conflicts, "exact_duplicates_removed": n_before - len(df)}


def group_split(df: pd.DataFrame, val_size: float, test_size: float, seed: int, use_groups: bool):
    """Stratified split at group level. A group = images sharing a dHash (or one image)."""
    df = df.copy()
    df["group"] = df["dhash"] if use_groups else df["md5"]
    # a near-duplicate group whose members disagree on the label is ambiguous: drop it
    mixed = df.groupby("group")["label"].nunique()
    mixed = set(mixed[mixed > 1].index)
    n_mixed = int(df["group"].isin(mixed).sum())
    df = df[~df["group"].isin(mixed)]

    groups = df.groupby("group")["label"].first().reset_index()
    train_g, tmp_g = train_test_split(groups, test_size=val_size + test_size, random_state=seed, stratify=groups["label"])
    rel_test = test_size / (val_size + test_size)
    val_g, test_g = train_test_split(tmp_g, test_size=rel_test, random_state=seed, stratify=tmp_g["label"])
    split_of = {**{g: "train" for g in train_g["group"]}, **{g: "val" for g in val_g["group"]}, **{g: "test" for g in test_g["group"]}}
    df["split"] = df["group"].map(split_of)
    return df, n_mixed


def assert_no_leak(df: pd.DataFrame) -> None:
    for key in ("md5", "group"):
        per = df.groupby(key)["split"].nunique()
        assert (per == 1).all(), f"LEAK: a {key} appears in two splits"


def cap_per_class(df: pd.DataFrame, n: int, seed: int) -> pd.DataFrame:
    parts = [g.sample(min(len(g), n), random_state=seed) for _, g in df.groupby("label")]
    return pd.concat(parts).reset_index(drop=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw-dir", default=None)
    args = ap.parse_args()
    params = load_params()
    p, seed = params["data"], params["seed"]
    set_seed(seed)

    raw_dir = Path(args.raw_dir or ROOT / p["raw_dir"])
    if not raw_dir.exists():
        raise SystemExit(f"{raw_dir} not found: run `python -m src.data.download` or `dvc pull` first.")
    out = ROOT / p["processed_dir"]
    out.mkdir(parents=True, exist_ok=True)

    df, corrupt = scan_images(raw_dir)
    n_readable = len(df)
    df, cleaning = clean(df)
    if p.get("quick_n"):
        df = cap_per_class(df, int(p["quick_n"]), seed)

    classes = sorted(df["label"].unique())
    class_to_idx = {c: i for i, c in enumerate(classes)}
    df["class_idx"] = df["label"].map(class_to_idx)
    assert df["label"].value_counts().min() >= 10, "A class has fewer than 10 images."

    df, n_mixed = group_split(df, p["val_size"], p["test_size"], seed, p["group_near_duplicates"])
    assert_no_leak(df)

    cols = ["path", "label", "class_idx", "md5", "dhash"]
    for split in ("train", "val", "test"):
        df[df["split"] == split][cols].to_csv(out / f"{split}.csv", index=False)
    save_json(class_to_idx, out / "classes.json")

    counts = df["split"].value_counts().to_dict()
    near_dup_groups = int((df.groupby("group").size() > 1).sum())
    summary = {
        "dataset": "PlantVillage (Kaggle abdallahalidev/plantvillage-dataset, color)",
        "seed": seed,
        "classes": len(classes),
        "readable_images": n_readable,
        "corrupt_images_removed": len(corrupt),
        **cleaning,
        "near_duplicate_groups": near_dup_groups,
        "ambiguous_group_images_removed": n_mixed,
        "kept_images": int(len(df)),
        "train": int(counts.get("train", 0)),
        "val": int(counts.get("val", 0)),
        "test": int(counts.get("test", 0)),
        "imbalance_ratio": round(float(df["label"].value_counts().max() / df["label"].value_counts().min()), 2),
        "per_class": {k: int(v) for k, v in df["label"].value_counts().sort_index().items()},
    }
    save_json(summary, out / "summary.json")
    save_json(
        {k: summary[k] for k in ("classes", "kept_images", "train", "val", "test", "exact_duplicates_removed", "near_duplicate_groups")},
        ROOT / "reports" / "data.json",
    )
    print(f"train {summary['train']} | val {summary['val']} | test {summary['test']} | classes {len(classes)} | no leak")


if __name__ == "__main__":
    main()
