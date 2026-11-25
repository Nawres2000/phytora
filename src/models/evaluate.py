"""Stage `evaluate`: final, one-time evaluation of the best checkpoint on the held-out TEST split.

Outputs (also logged to the training MLflow run):
reports/metrics.json, classification_report.json, per_class.csv, top_confusions.csv,
confusion_matrix.csv and confusion_matrix.png.

Usage: python -m src.models.evaluate
"""

import numpy as np
import pandas as pd
import torch
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, f1_score, top_k_accuracy_score

from src.data.dataset import build_transforms, make_loader
from src.models.checkpoint import load_checkpoint
from src.utils.common import ROOT, load_json, load_params, save_json, setup_mlflow


@torch.no_grad()
def predict_probs(model, loader, device):
    probs, ys = [], []
    for x, y in loader:
        probs.append(torch.softmax(model(x.to(device)), 1).cpu().numpy())
        ys.append(y.numpy())
    return np.concatenate(probs), np.concatenate(ys)


def top_confusions(cm, classes, k=10):
    off = cm.copy()
    np.fill_diagonal(off, 0)
    rows = []
    for flat in np.argsort(off.ravel())[::-1][:k]:
        i, j = np.unravel_index(flat, off.shape)
        if off[i, j] > 0:
            rows.append({"true": classes[i], "predicted": classes[j], "count": int(off[i, j])})
    return pd.DataFrame(rows)


def plot_confusion(cm, title, path):
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    norm = cm / np.maximum(cm.sum(axis=1, keepdims=True), 1)
    fig, ax = plt.subplots(figsize=(10, 9))
    im = ax.imshow(norm, cmap="Greens", vmin=0, vmax=1)
    ax.set_xlabel("predicted class (index)")
    ax.set_ylabel("true class (index)")
    ax.set_title(title)
    fig.colorbar(im, ax=ax, fraction=0.04)
    fig.tight_layout()
    fig.savefig(path, dpi=120)
    plt.close(fig)


def main():
    params = load_params()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    proc, raw, reports = ROOT / params["data"]["processed_dir"], ROOT / params["data"]["raw_dir"], ROOT / "reports"
    model, meta = load_checkpoint(ROOT / "models" / "model.pt", device)
    classes = meta["classes"]
    test_df = pd.read_csv(proc / "test.csv")
    loader = make_loader(test_df, raw, build_transforms(meta["img_size"], False), 64, False, params["train"]["num_workers"])

    probs, y = predict_probs(model, loader, device)
    pred = probs.argmax(1)
    labels = list(range(len(classes)))
    eps = 1e-12
    metrics = {
        "model": meta["model"],
        "test_images": int(len(y)),
        "test_acc": float(accuracy_score(y, pred)),
        "test_macro_f1": float(f1_score(y, pred, average="macro", zero_division=0)),
        "test_weighted_f1": float(f1_score(y, pred, average="weighted", zero_division=0)),
        "test_top3_acc": float(top_k_accuracy_score(y, probs, k=3, labels=labels)),
        "test_loss": float(-np.log(probs[np.arange(len(y)), y] + eps).mean()),
        "best_val_macro_f1": float(meta.get("best_val_macro_f1", 0)),
    }
    report = classification_report(y, pred, labels=labels, target_names=classes, output_dict=True, zero_division=0)
    cm = confusion_matrix(y, pred, labels=labels)
    per_class = pd.DataFrame({c: report[c] for c in classes}).T.sort_values("recall")

    save_json(metrics, reports / "metrics.json")
    save_json(report, reports / "classification_report.json")
    per_class.to_csv(reports / "per_class.csv")
    top_confusions(cm, classes).to_csv(reports / "top_confusions.csv", index=False)
    pd.DataFrame(cm, index=classes, columns=classes).to_csv(reports / "confusion_matrix.csv")
    plot_confusion(cm, f"Normalised confusion matrix (test) - {meta['model']}", reports / "confusion_matrix.png")
    print({k: round(v, 4) if isinstance(v, float) else v for k, v in metrics.items()})
    print("Weakest classes (recall):\n", per_class["recall"].head(5).round(3).to_string())

    run_id = meta.get("mlflow_run_id") or load_json(reports / "train.json").get("mlflow_run_id")
    mlflow = setup_mlflow(params["mlflow"]["experiment"])
    with mlflow.start_run(run_id=run_id):
        mlflow.log_metrics({k: v for k, v in metrics.items() if isinstance(v, float)})
        for f in ("metrics.json", "classification_report.json", "per_class.csv", "top_confusions.csv", "confusion_matrix.png"):
            mlflow.log_artifact(str(reports / f), "evaluation")


if __name__ == "__main__":
    main()
