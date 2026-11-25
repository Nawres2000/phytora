"""Benchmark table of every run in the MLflow experiment (baseline vs advanced models, ablations).

Typical workflow (each `dvc exp run` trains, evaluates and logs one MLflow run):
    dvc exp run -S train.model=baseline_cnn
    dvc exp run -S train.model=mobilenet_v3_small
    dvc exp run -S train.model=efficientnet_v2_s
    dvc exp run -S train.model=mobilenet_v3_small -S train.loss=focal -S train.mix=cutmix -S train.randaugment=true
    python -m src.models.compare            # -> reports/comparison.csv + reports/comparison.md
"""

from src.utils.common import ROOT, load_params, setup_mlflow

COLS = {
    "tags.mlflow.runName": "run",
    "params.train.model": "architecture",
    "params.train.loss": "loss",
    "params.train.mix": "mix",
    "params.train.randaugment": "randaugment",
    "params.n_params": "params",
    "metrics.best_val_macro_f1": "val_macro_f1",
    "metrics.test_acc": "test_acc",
    "metrics.test_macro_f1": "test_macro_f1",
    "metrics.test_top3_acc": "test_top3",
}


def main():
    params = load_params()
    mlflow = setup_mlflow(params["mlflow"]["experiment"])
    runs = mlflow.search_runs(experiment_names=[params["mlflow"]["experiment"]], order_by=["metrics.test_macro_f1 DESC"])
    if runs.empty:
        raise SystemExit("No MLflow run yet: run `dvc repro` first.")
    table = runs[[c for c in COLS if c in runs.columns]].rename(columns=COLS)
    for c in ("val_macro_f1", "test_acc", "test_macro_f1", "test_top3"):
        if c in table:
            table[c] = table[c].round(4)
    out = ROOT / "reports"
    out.mkdir(exist_ok=True)
    table.to_csv(out / "comparison.csv", index=False)
    (out / "comparison.md").write_text(
        table.to_markdown(index=False) if hasattr(table, "to_markdown") else table.to_string(index=False), encoding="utf-8"
    )
    print(table.to_string(index=False))


if __name__ == "__main__":
    main()
