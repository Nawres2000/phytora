"""Stage `train`: trains the model chosen in params.yaml and tracks everything in MLflow.

- pretrained backbones: phase 1 = head only (backbone frozen), phase 2 = last blocks unfrozen with a lower LR;
- baseline_cnn: one phase, whole network, from scratch;
- the best epoch (validation macro-F1) is kept and saved with everything the API needs
  (classes, image size, normalisation, architecture name).

MLflow: params (params.yaml flattened), per-epoch metrics, history CSV, learning curves, checkpoint.
The run id is written to reports/train.json so `evaluate` and `export` log into the same run.

Usage: python -m src.models.train [--model NAME] [--epochs-scale 0.5]
"""

import argparse
import copy
import time

import numpy as np
import pandas as pd
import torch
import torch.optim as optim
from sklearn.metrics import accuracy_score, f1_score

from src.data.augment import mix_batch
from src.data.dataset import build_transforms, make_loader
from src.models.architecture import build_model, count_params
from src.models.losses import build_criterion, class_weights
from src.utils.common import IMAGENET_MEAN, IMAGENET_STD, ROOT, flatten, load_json, load_params, save_json, set_seed, setup_mlflow


def run_epoch(model, loader, criterion, device, optimizer=None, freeze_bn=False, mix=None, scaler=None):
    training = optimizer is not None
    model.train(training)
    if training and freeze_bn:  # keep the ImageNet BatchNorm statistics (stability with small batches)
        for m in model.modules():
            if isinstance(m, torch.nn.BatchNorm2d):
                m.eval()
    total, y_true, y_pred = 0.0, [], []
    with torch.set_grad_enabled(training):
        for x, y in loader:
            x, y = x.to(device, non_blocking=True), y.to(device, non_blocking=True)
            if training and mix:
                x, ya, yb, lam = mix_batch(x, y, *mix)
            else:
                ya, yb, lam = y, y, 1.0
            with torch.autocast(device.type, enabled=scaler is not None):
                out = model(x)
                loss = lam * criterion(out, ya) + (1 - lam) * criterion(out, yb) if lam < 1 else criterion(out, ya)
            if training:
                optimizer.zero_grad(set_to_none=True)
                if scaler is not None:
                    scaler.scale(loss).backward()
                    scaler.step(optimizer)
                    scaler.update()
                else:
                    loss.backward()
                    optimizer.step()
            total += loss.item() * y.size(0)
            y_true.append(y.cpu().numpy())
            y_pred.append(out.argmax(1).cpu().numpy())
    y_true, y_pred = np.concatenate(y_true), np.concatenate(y_pred)
    return {
        "loss": total / len(y_true),
        "acc": float(accuracy_score(y_true, y_pred)),
        "macro_f1": float(f1_score(y_true, y_pred, average="macro", zero_division=0)),
    }


def build_phases(model, name: str, t: dict, scale: float):
    """Each phase: (name, epochs, optimizer factory)."""
    e = lambda n: max(1, round(n * scale))  # noqa: E731
    wd = t["weight_decay"]
    if name == "baseline_cnn":
        return [("scratch", e(t["epochs_scratch"]), lambda m: optim.AdamW(m.parameters(), lr=t["lr_scratch"], weight_decay=wd), False)]

    def head_only(m):
        for p in m.features.parameters():
            p.requires_grad = False
        for p in m.classifier.parameters():
            p.requires_grad = True
        return optim.AdamW(m.classifier.parameters(), lr=t["lr_head"], weight_decay=wd)

    def finetune(m):
        last = m.features[-t["unfreeze_last"] :]
        for p in last.parameters():
            p.requires_grad = True
        return optim.AdamW(
            [{"params": last.parameters(), "lr": t["lr_backbone"]}, {"params": m.classifier.parameters(), "lr": t["lr_finetune_head"]}],
            weight_decay=wd,
        )

    return [("head", e(t["epochs_head"]), head_only, t["freeze_bn"]), ("finetune", e(t["epochs_finetune"]), finetune, t["freeze_bn"])]


def plot_history(hist: pd.DataFrame, path):
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig, ax = plt.subplots(1, 2, figsize=(12, 4))
    ax[0].plot(hist["epoch"], hist["train_macro_f1"], "--o", label="train")
    ax[0].plot(hist["epoch"], hist["val_macro_f1"], "-o", label="val")
    ax[0].set_title("Macro-F1")
    ax[1].plot(hist["epoch"], hist["train_loss"], "--o", label="train")
    ax[1].plot(hist["epoch"], hist["val_loss"], "-o", label="val")
    ax[1].set_title("Loss")
    for a in ax:
        a.set_xlabel("epoch")
        a.legend()
        a.grid(alpha=0.3)
    fig.tight_layout()
    fig.savefig(path, dpi=120)
    plt.close(fig)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", help="override train.model")
    ap.add_argument("--epochs-scale", type=float, default=1.0, help="multiply every phase length (quick tests)")
    args = ap.parse_args()

    params = load_params()
    t, seed = params["train"], params["seed"]
    if args.model:
        t["model"] = args.model
    set_seed(seed)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    proc = ROOT / params["data"]["processed_dir"]
    raw = ROOT / params["data"]["raw_dir"]
    class_to_idx = load_json(proc / "classes.json")
    classes = [c for c, _ in sorted(class_to_idx.items(), key=lambda kv: kv[1])]
    train_df, val_df = pd.read_csv(proc / "train.csv"), pd.read_csv(proc / "val.csv")

    pin = device.type == "cuda"
    train_loader = make_loader(
        train_df, raw, build_transforms(t["img_size"], True, t["randaugment"]), t["batch_size"], True, t["num_workers"], pin
    )
    val_loader = make_loader(val_df, raw, build_transforms(t["img_size"], False), t["batch_size"], False, t["num_workers"], pin)

    weights = class_weights(train_df["class_idx"], len(classes)).to(device)
    criterion = build_criterion(t["loss"], weights, t["focal_gamma"], t["label_smoothing"]).to(device)
    model = build_model(t["model"], len(classes), pretrained=t["pretrained"] and t["model"] != "baseline_cnn").to(device)
    scaler = torch.amp.GradScaler() if t["amp"] and device.type == "cuda" else None
    mix = (t["mix"], t["mix_alpha"], t["mix_prob"]) if t["mix"] != "none" else None

    models_dir, reports = ROOT / "models", ROOT / "reports"
    models_dir.mkdir(exist_ok=True)
    reports.mkdir(exist_ok=True)
    ckpt_path = models_dir / "model.pt"

    mlflow = setup_mlflow(params["mlflow"]["experiment"])
    with mlflow.start_run(run_name=f"{t['model']}-{t['loss']}-{t['mix']}") as run:
        mlflow.log_params(flatten(params))
        mlflow.log_params({"n_params": count_params(model), "device": device.type, "n_train": len(train_df), "n_val": len(val_df)})
        mlflow.set_tags({"stage": "train", "architecture": t["model"]})
        data_summary = proc / "summary.json"
        if data_summary.exists():
            mlflow.log_artifact(str(data_summary), "data")

        history, best_f1, best_state, epoch = [], -1.0, None, 0
        for phase, n_epochs, setup, freeze_bn in build_phases(model, t["model"], t, args.epochs_scale):
            optimizer = setup(model)
            sched = optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=n_epochs) if t["scheduler"] == "cosine" else None
            print(f"=== {t['model']} | {phase} ({n_epochs} epochs) on {device}")
            for _ in range(n_epochs):
                epoch += 1
                t0 = time.time()
                tr = run_epoch(model, train_loader, criterion, device, optimizer, freeze_bn, mix, scaler)
                va = run_epoch(model, val_loader, criterion, device)
                if sched:
                    sched.step()
                row = {
                    "epoch": epoch,
                    "phase": phase,
                    **{f"train_{k}": v for k, v in tr.items()},
                    **{f"val_{k}": v for k, v in va.items()},
                    "seconds": round(time.time() - t0, 1),
                }
                history.append(row)
                mlflow.log_metrics({k: v for k, v in row.items() if k not in ("epoch", "phase")}, step=epoch)
                mark = ""
                if va["macro_f1"] > best_f1:
                    best_f1, best_state, mark = va["macro_f1"], copy.deepcopy(model.state_dict()), "  <- best"
                    torch.save(
                        {
                            "model": t["model"],
                            "state_dict": best_state,
                            "classes": classes,
                            "img_size": t["img_size"],
                            "mean": IMAGENET_MEAN,
                            "std": IMAGENET_STD,
                            "best_val_macro_f1": best_f1,
                            "epoch": epoch,
                            "mlflow_run_id": run.info.run_id,
                        },
                        ckpt_path,
                    )
                print(
                    f"epoch {epoch:02d} | loss {tr['loss']:.3f}/{va['loss']:.3f} | val acc {va['acc']:.4f} | "
                    f"val macro-F1 {va['macro_f1']:.4f} | {row['seconds']}s{mark}"
                )

        hist = pd.DataFrame(history)
        hist.to_csv(reports / "train_history.csv", index=False)
        plot_history(hist, reports / "learning_curves.png")
        best = hist.loc[hist["val_macro_f1"].idxmax()]
        summary = {
            "model": t["model"],
            "best_epoch": int(best["epoch"]),
            "best_val_macro_f1": float(best["val_macro_f1"]),
            "best_val_acc": float(best["val_acc"]),
            "epochs": int(epoch),
            "n_params": count_params(model),
            "train_seconds": float(hist["seconds"].sum()),
            "mlflow_run_id": run.info.run_id,
        }
        save_json(summary, reports / "train.json")
        mlflow.log_metrics({"best_val_macro_f1": summary["best_val_macro_f1"], "best_val_acc": summary["best_val_acc"]})
        mlflow.log_artifact(str(reports / "train_history.csv"), "reports")
        mlflow.log_artifact(str(reports / "learning_curves.png"), "reports")
        mlflow.log_artifact(str(ckpt_path), "checkpoint")
        print(f"best val macro-F1 {best_f1:.4f} (epoch {summary['best_epoch']}) | MLflow run {run.info.run_id}")


if __name__ == "__main__":
    main()
