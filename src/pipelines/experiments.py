"""Experiment grid and cross-validation, orchestrated by Prefect.

`experiment-grid` runs several configurations of the DVC pipeline (baseline vs transfer learning,
loss / augmentation ablations, other backbones). Each one is a `dvc exp run --temp`: it runs in an
isolated copy of the repository, so the model served by the API is never touched, and it produces
one MLflow run (params, per-epoch metrics, artefacts) plus one new version of `phytora-classifier`
in the Model Registry (alias "staging"; promoted to "production" only if it beats the current one).

Error handling: one experiment failing (out of memory, bad hyper-parameters...) does not stop the
grid; it is retried once, then reported as failed in the comparison table and in the alerts.

Usage:
    python -m src.pipelines.experiments                       # default grid, quick_n=50 (CPU friendly)
    prefect deployment run experiment-grid/experiment-grid    # from the Prefect UI / CLI
"""

import json
import os
from datetime import datetime, timezone

from prefect import flow, task

from src.pipelines.flows import get_run_logger, on_flow_failure, sh, write_alert
from src.utils.common import ROOT

# name -> params overrides (dvc exp run -S key=value)
DEFAULT_GRID = {
    "baseline-cnn": {"train.model": "baseline_cnn"},
    "mobilenet-weighted-ce": {"train.model": "mobilenet_v3_small", "train.loss": "weighted_ce"},
    "mobilenet-focal-cutmix-randaug": {
        "train.model": "mobilenet_v3_small",
        "train.loss": "focal",
        "train.mix": "cutmix",
        "train.randaugment": "true",
    },
    "efficientnet-v2-s": {"train.model": "efficientnet_v2_s", "train.batch_size": "16"},
}


def _mlflow_env() -> dict:
    """`--temp` runs in a copy of the repo: point MLflow at the main store, not at the copy."""
    env = {}
    if not os.getenv("MLFLOW_TRACKING_URI"):
        env["MLFLOW_TRACKING_URI"] = f"sqlite:///{ROOT / 'mlflow.db'}"
        env["MLFLOW_ARTIFACT_LOCATION"] = (ROOT / "mlruns").as_uri()
    return env


@task(retries=1, retry_delay_seconds=30, timeout_seconds=8 * 3600, tags=["experiment"])
def run_experiment(name: str, overrides: dict, quick_n: int) -> dict:
    logger = get_run_logger()
    os.environ.update(_mlflow_env())
    args = ["dvc", "exp", "run", "--temp", "-n", name]
    for key, value in {**overrides, "data.quick_n": str(quick_n)}.items():
        args += ["-S", f"{key}={value}"]
    logger.info("experiment %s: %s", name, " ".join(args[5:]))
    sh(args)
    return {"name": name, "status": "done", **overrides}


@task
def collect_results(names: list[str]) -> list[dict]:
    """Metrics of the DVC experiments (dvc exp show), saved as reports/experiments.md / .json."""
    raw = json.loads(sh(["dvc", "exp", "show", "--json", "--no-pager"]) or "[]")
    rows = []

    def walk(node):
        if isinstance(node, dict):
            name = node.get("name") or node.get("rev")
            data = node.get("data") or {}
            metrics = {}
            for _file, content in (data.get("metrics") or {}).items():
                metrics.update((content or {}).get("data") or {})
            params = {}
            for _file, content in (data.get("params") or {}).items():
                params.update((content or {}).get("data") or {})
            if name in names and metrics:
                train = params.get("train", {})
                rows.append(
                    {
                        "experiment": name,
                        "model": train.get("model"),
                        "loss": train.get("loss"),
                        "mix": train.get("mix"),
                        "randaugment": train.get("randaugment"),
                        "test_acc": metrics.get("test_acc"),
                        "test_macro_f1": metrics.get("test_macro_f1"),
                        "best_val_macro_f1": metrics.get("best_val_macro_f1"),
                    }
                )
            for child in node.get("experiments") or []:
                walk(child)
            for child in node.get("revs") or []:
                walk(child)
        elif isinstance(node, list):
            for child in node:
                walk(child)

    walk(raw)
    rows.sort(key=lambda r: -(r.get("test_macro_f1") or 0))
    out = ROOT / "reports"
    out.mkdir(exist_ok=True)
    (out / "experiments.json").write_text(json.dumps(rows, indent=2), encoding="utf-8")
    lines = ["| experiment | model | loss | mix | randaugment | test acc | test macro-F1 |", "|---|---|---|---|---|---|---|"]
    for r in rows:
        fmt = lambda v: f"{v:.4f}" if isinstance(v, (int, float)) else "–"  # noqa: E731
        lines.append(
            f"| {r['experiment']} | {r['model']} | {r['loss']} | {r['mix']} | {r['randaugment']} | "
            f"{fmt(r['test_acc'])} | {fmt(r['test_macro_f1'])} |"
        )
    (out / "experiments.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    return rows


@flow(name="experiment-grid", on_failure=[on_flow_failure], log_prints=True)
def experiment_grid(quick_n: int = 50, grid: dict | None = None) -> dict:
    """Run every configuration of `grid` (default: baseline, MobileNet, ablation, EfficientNet).

    quick_n: images per class (0 = full dataset; use a GPU for that).
    """
    logger = get_run_logger()
    grid = grid or DEFAULT_GRID
    results, failed = [], []
    for name, overrides in grid.items():
        future = run_experiment.submit(name, overrides, quick_n)
        try:
            results.append(future.result())
        except Exception as e:  # noqa: BLE001  one bad configuration must not stop the grid
            failed.append({"name": name, "error": f"{type(e).__name__}: {str(e)[:300]}"})
            logger.error("experiment %s failed: %s", name, e)
    if failed:
        write_alert("warning", "Expériences en échec", {"failed": failed})
    rows = collect_results([r["name"] for r in results]) if results else []
    summary = {
        "finished_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "quick_n": quick_n,
        "succeeded": [r["name"] for r in results],
        "failed": failed,
        "ranking": rows,
    }
    logger.info("grid done: %d ok, %d failed. Best: %s", len(results), len(failed), rows[0]["experiment"] if rows else "-")
    return summary


@flow(name="cross-validation", on_failure=[on_flow_failure], log_prints=True)
def cross_validation(folds: int = 3, quick_n: int = 50, model: str = "mobilenet_v3_small") -> dict:
    """Stratified group k-fold on train+val (test untouched): mean +/- std of the macro-F1, logged to MLflow."""
    from src.models.cross_validate import run as run_cv

    os.environ.update(_mlflow_env())
    sh(["dvc", "repro", "--single-item", "prepare"])  # the folds are built from the DVC train/val splits
    return run_cv(folds=folds, quick_n=quick_n, model=model)


if __name__ == "__main__":
    print(json.dumps(experiment_grid(), indent=2))
