"""Stratified GROUP k-fold cross-validation (estimate of the variance of the score).

- pool = train + val splits of the DVC `prepare` stage (the test split is never used here);
- folds are stratified by class and grouped by perceptual hash (dHash), so near-duplicates never
  end up on both sides of a fold (same anti-leakage rule as `prepare`);
- each fold trains the model with the params.yaml settings and reports validation macro-F1 / accuracy;
- MLflow: one parent run "cv-<model>" with one nested run per fold, plus cv_macro_f1_mean / _std;
- output: reports/cross_validation.json.

Usage: python -m src.models.cross_validate --folds 3 --quick-n 50
"""

import argparse

import numpy as np
import pandas as pd
import torch
from sklearn.model_selection import StratifiedGroupKFold

from src.data.dataset import build_transforms, make_loader
from src.models.architecture import build_model
from src.models.losses import build_criterion, class_weights
from src.models.train import build_phases, run_epoch
from src.utils.common import ROOT, flatten, load_json, load_params, save_json, set_seed, setup_mlflow


def run(folds: int = 3, quick_n: int = 0, model: str | None = None, epochs_scale: float = 1.0) -> dict:
    params = load_params()
    t, seed = params["train"], params["seed"]
    if model:
        t["model"] = model
    set_seed(seed)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    proc, raw = ROOT / params["data"]["processed_dir"], ROOT / params["data"]["raw_dir"]
    classes = load_json(proc / "classes.json")
    pool = pd.concat([pd.read_csv(proc / "train.csv"), pd.read_csv(proc / "val.csv")], ignore_index=True)
    if quick_n:
        pool = pd.concat([g.sample(min(len(g), quick_n), random_state=seed) for _, g in pool.groupby("class_idx")], ignore_index=True)

    splitter = StratifiedGroupKFold(n_splits=folds, shuffle=True, random_state=seed)
    groups = pool["dhash"] if "dhash" in pool else pool["md5"]
    mlflow = setup_mlflow(params["mlflow"]["experiment"])
    scores = []
    with mlflow.start_run(run_name=f"cv-{t['model']}-{folds}fold") as parent:
        mlflow.set_tags({"stage": "cross_validation", "architecture": t["model"]})
        mlflow.log_params({**flatten({"train": t}), "cv.folds": folds, "cv.quick_n": quick_n, "cv.pool_size": len(pool)})
        for k, (tr_idx, va_idx) in enumerate(splitter.split(pool, pool["class_idx"], groups)):
            tr, va = pool.iloc[tr_idx], pool.iloc[va_idx]
            assert not set(groups.iloc[tr_idx]) & set(groups.iloc[va_idx]), "LEAK between folds"
            train_loader = make_loader(
                tr, raw, build_transforms(t["img_size"], True, t["randaugment"]), t["batch_size"], True, t["num_workers"]
            )
            val_loader = make_loader(va, raw, build_transforms(t["img_size"], False), t["batch_size"], False, t["num_workers"])
            net = build_model(t["model"], len(classes), pretrained=t["pretrained"] and t["model"] != "baseline_cnn").to(device)
            criterion = build_criterion(
                t["loss"], class_weights(tr["class_idx"], len(classes)).to(device), t["focal_gamma"], t["label_smoothing"]
            ).to(device)
            best = {"macro_f1": -1.0}
            with mlflow.start_run(run_name=f"fold-{k + 1}", nested=True):
                epoch = 0
                for _phase, n_epochs, setup, freeze_bn in build_phases(net, t["model"], t, epochs_scale):
                    optimizer = setup(net)
                    for _ in range(n_epochs):
                        epoch += 1
                        run_epoch(net, train_loader, criterion, device, optimizer, freeze_bn)
                        va_m = run_epoch(net, val_loader, criterion, device)
                        mlflow.log_metrics({f"val_{m}": v for m, v in va_m.items()}, step=epoch)
                        if va_m["macro_f1"] > best["macro_f1"]:
                            best = va_m
                mlflow.log_metrics({"fold_best_macro_f1": best["macro_f1"], "fold_best_acc": best["acc"]})
            scores.append({"fold": k + 1, "n_train": len(tr), "n_val": len(va), "macro_f1": best["macro_f1"], "acc": best["acc"]})
            print(f"fold {k + 1}/{folds}: macro-F1 {best['macro_f1']:.4f} | acc {best['acc']:.4f}")
        f1 = np.array([s["macro_f1"] for s in scores])
        acc = np.array([s["acc"] for s in scores])
        summary = {
            "model": t["model"],
            "folds": folds,
            "quick_n": quick_n,
            "per_fold": scores,
            "cv_macro_f1_mean": float(f1.mean()),
            "cv_macro_f1_std": float(f1.std(ddof=1) if len(f1) > 1 else 0.0),
            "cv_acc_mean": float(acc.mean()),
            "cv_acc_std": float(acc.std(ddof=1) if len(acc) > 1 else 0.0),
            "mlflow_run_id": parent.info.run_id,
        }
        mlflow.log_metrics({k: v for k, v in summary.items() if k.startswith("cv_")})
        save_json(summary, ROOT / "reports" / "cross_validation.json")
        mlflow.log_artifact(str(ROOT / "reports" / "cross_validation.json"), "cross_validation")
    print(f"CV macro-F1 = {summary['cv_macro_f1_mean']:.4f} ± {summary['cv_macro_f1_std']:.4f}")
    return summary


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--folds", type=int, default=3)
    ap.add_argument("--quick-n", type=int, default=0)
    ap.add_argument("--model")
    ap.add_argument("--epochs-scale", type=float, default=1.0)
    a = ap.parse_args()
    run(a.folds, a.quick_n, a.model, a.epochs_scale)


if __name__ == "__main__":
    main()
