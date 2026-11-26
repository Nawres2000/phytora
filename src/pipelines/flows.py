"""Prefect orchestration of the PHYTORA ML lifecycle.

Flows (visible in the Prefect UI, http://localhost:4200):
- training_pipeline  : pull data -> validate -> prepare -> train -> evaluate -> QUALITY GATE -> export/register
                       -> drift reference -> dvc push -> reload the API.   Weekly + on demand + on drift/new data.
- monitoring_check   : Evidently drift check on the logged predictions; triggers retraining on drift (CT). Every 6 h.
- ingest_new_data    : validate images dropped in data/incoming, quarantine the bad ones, version the good ones
                       with DVC, then trigger retraining.  Every 30 min.

Error handling / recovery
- transient failures (network: DVC remote, pretrained weights download; API reload) -> automatic retries
  with exponential backoff (`retries`, `retry_delay_seconds`, `timeout_seconds`);
- deterministic failures (invalid data, model below the quality gate) -> no retry, fail fast with an explicit error;
- any failure after training -> ROLLBACK task: dvc.lock and the model artefacts are restored to the last
  committed version (git checkout dvc.lock + dvc checkout), so production keeps the previous model;
- flow hooks (`on_failure`, `on_completion`) write an alert line (reports/monitoring/alerts.jsonl) and call an
  optional webhook (ALERT_WEBHOOK_URL: Slack, Teams, Discord...);
- DVC caching makes a re-run resume where it failed: completed stages are skipped.
"""

import json
import os
import shutil
import subprocess
from datetime import datetime, timezone

import httpx
from prefect import flow, task
from prefect import get_run_logger as _run_logger
from prefect.exceptions import MissingContextError
from prefect.logging import get_logger
from prefect.tasks import exponential_backoff

from src.utils.common import EXTENSIONS, ROOT, load_json, load_params

ALERTS = ROOT / "reports" / "monitoring" / "alerts.jsonl"
STATUS = ROOT / "reports" / "pipeline_status.json"
API_URL = os.getenv("MODEL_API_URL", "http://localhost:8000")


class DataValidationError(Exception):
    """The dataset is missing or unusable: retrying will not help."""


class QualityGateError(Exception):
    """The new model is not good enough to replace the production model."""


class StageError(RuntimeError):
    """A DVC stage failed (stderr tail attached)."""


# ---------------------------------------------------------------- helpers
def get_run_logger():
    """Prefect run logger (shown in the UI), or a plain logger when a task function is called directly."""
    try:
        return _run_logger()
    except MissingContextError:
        return get_logger("phytora.pipelines")


def sh(cmd: list[str], timeout: int | None = None) -> str:
    proc = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, timeout=timeout)
    if proc.returncode != 0:
        raise StageError(f"{' '.join(cmd)} failed (exit {proc.returncode}):\n{(proc.stderr or proc.stdout)[-2000:]}")
    return proc.stdout


def write_alert(level: str, title: str, details: dict) -> None:
    record = {"ts": datetime.now(timezone.utc).isoformat(timespec="seconds"), "level": level, "title": title, **details}
    ALERTS.parent.mkdir(parents=True, exist_ok=True)
    with open(ALERTS, "a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")
    url = os.getenv("ALERT_WEBHOOK_URL")
    if url:
        try:
            httpx.post(url, json={"text": f"[PHYTORA {level.upper()}] {title}: {json.dumps(details, ensure_ascii=False)[:500]}"}, timeout=5)
        except httpx.HTTPError:
            pass  # alerting must never break the pipeline


def on_flow_failure(flow, flow_run, state):
    write_alert("error", f"Flow {flow.name} en échec", {"run": flow_run.name, "message": str(state.message)[:500]})


def on_flow_completion(flow, flow_run, state):
    write_alert("info", f"Flow {flow.name} terminé", {"run": flow_run.name})


# ---------------------------------------------------------------- tasks
@task(retries=3, retry_delay_seconds=exponential_backoff(backoff_factor=10), retry_jitter_factor=0.5)
def pull_data() -> str:
    """Fetch the versioned dataset from the DVC remote (network: retried)."""
    logger = get_run_logger()
    if (ROOT / "data" / "raw" / "plantvillage.dvc").exists():
        out = sh(["dvc", "pull", "data/raw/plantvillage.dvc"], timeout=3600)
        logger.info("dvc pull: %s", out.strip()[-300:] or "up to date")
        return "pulled"
    logger.warning("data/raw/plantvillage.dvc not found: using the local data folder")
    return "local"


@task
def validate_data(min_per_class: int = 10) -> dict:
    """Fail fast (no retry) when the dataset is missing or a class is too small."""
    params = load_params()
    raw = ROOT / params["data"]["raw_dir"]
    if not raw.exists():
        raise DataValidationError(f"{raw} not found (dvc pull or python -m src.data.download)")
    counts = {d.name: sum(1 for p in d.iterdir() if p.suffix.lower() in EXTENSIONS) for d in raw.iterdir() if d.is_dir()}
    if not counts:
        raise DataValidationError(f"no class folder in {raw}")
    small = {k: v for k, v in counts.items() if v < min_per_class}
    if small:
        raise DataValidationError(f"classes with fewer than {min_per_class} images: {small}")
    get_run_logger().info("dataset OK: %d classes, %d images", len(counts), sum(counts.values()))
    return {"classes": len(counts), "images": sum(counts.values())}


@task(retries=2, retry_delay_seconds=exponential_backoff(backoff_factor=15), timeout_seconds=6 * 3600, tags=["dvc"])
def run_stage(stage: str) -> str:
    """One DVC stage. Unchanged stages are skipped by DVC; transient errors are retried."""
    out = sh(["dvc", "repro", "--single-item", stage])
    get_run_logger().info("%s: %s", stage, out.strip().splitlines()[-1] if out.strip() else "done")
    return stage


@task
def quality_gate(min_macro_f1: float) -> dict:
    """Deterministic check on the TEST metrics: never retried."""
    metrics = load_json(ROOT / "reports" / "metrics.json")
    f1 = metrics.get("test_macro_f1", 0.0)
    if f1 < min_macro_f1:
        raise QualityGateError(f"test macro-F1 {f1:.4f} < required {min_macro_f1:.2f}: model rejected")
    get_run_logger().info("quality gate passed: test macro-F1 %.4f >= %.2f", f1, min_macro_f1)
    return metrics


@task
def rollback(reason: str) -> None:
    """Restore the last committed model (dvc.lock from git + matching artefacts from the DVC cache)."""
    logger = get_run_logger()
    in_head = subprocess.run(["git", "cat-file", "-e", "HEAD:dvc.lock"], cwd=ROOT, capture_output=True).returncode == 0
    if not in_head:
        # first training ever: nothing committed to go back to. The rejected run never reached `export`,
        # so models/metadata.json was not written and the API keeps serving models/legacy.
        logger.warning("rollback (%s): no committed model yet, production keeps models/legacy", reason)
    else:
        sh(["git", "checkout", "HEAD", "--", "dvc.lock"])
        # outputs of stages that never ran are reported as missing: restore what exists, do not crash
        proc = subprocess.run(["dvc", "checkout", "--force"], cwd=ROOT, capture_output=True, text=True)
        if proc.returncode != 0:
            logger.warning("dvc checkout partial: %s", (proc.stderr or proc.stdout).strip()[-300:])
        logger.warning("rollback done (%s): artefacts of the last committed model restored", reason)
    write_alert("warning", "Rollback du modèle", {"reason": reason, "restored_from_git": in_head})


@task(retries=3, retry_delay_seconds=[10, 30, 90])
def push_artifacts() -> None:
    """Upload the new data / model versions to the DVC remote (network: retried)."""
    sh(["dvc", "push"], timeout=3600)


@task(retries=3, retry_delay_seconds=[5, 15, 45])
def reload_api() -> dict:
    """Ask the running API to load the new model (it keeps the old one if loading fails)."""
    token = os.getenv("ADMIN_TOKEN")
    if not token:
        get_run_logger().warning("ADMIN_TOKEN not set: the API will load the new model at its next restart")
        return {"reloaded": False}
    r = httpx.post(f"{API_URL}/admin/reload", headers={"X-Admin-Token": token}, timeout=60)
    r.raise_for_status()
    return r.json()


@task(retries=1, retry_delay_seconds=30)
def drift_check() -> dict:
    from src.monitoring.drift import run

    return run()


# ---------------------------------------------------------------- flows
@flow(name="training-pipeline", on_failure=[on_flow_failure], on_completion=[on_flow_completion], log_prints=True)
def training_pipeline(reason: str = "manual", push: bool = True, reload: bool = True) -> dict:
    """Retrain, evaluate, gate, register and deploy a model. `reason`: manual | schedule | drift | new_data."""
    logger = get_run_logger()
    logger.info("training pipeline started (reason: %s)", reason)
    params = load_params()
    pull_data()
    data = validate_data()
    run_stage("prepare")
    try:
        run_stage("train")
        run_stage("evaluate")
        metrics = quality_gate(params["pipeline"]["min_test_macro_f1"])
        run_stage("export")  # ONNX + MLflow registry (promoted to production only if better)
        run_stage("reference")  # new drift reference for the new model
    except Exception as e:
        rollback(f"{type(e).__name__}: {str(e)[:200]}")
        raise
    if push:
        push_artifacts()
    deployed = reload_api() if reload else {"reloaded": False}
    status = {
        "finished_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "reason": reason,
        "data": data,
        "test_macro_f1": metrics.get("test_macro_f1"),
        "test_acc": metrics.get("test_acc"),
        "deployed": deployed,
    }
    STATUS.write_text(json.dumps(status, indent=2), encoding="utf-8")
    return status


def trigger_retraining(reason: str) -> str:
    """Continuous Training trigger: Prefect deployment if served, else GitHub `ct.yml` via repository_dispatch."""
    logger = get_run_logger()
    try:
        from prefect.deployments import run_deployment

        run = run_deployment("training-pipeline/training-pipeline", parameters={"reason": reason}, timeout=0)
        logger.info("retraining scheduled: flow run %s", run.name)
        return f"prefect:{run.name}"
    except Exception as e:  # noqa: BLE001  (not served: no deployment registered)
        logger.warning("Prefect deployment unavailable (%s)", e)
    token, repo = os.getenv("GITHUB_TOKEN"), os.getenv("GITHUB_REPOSITORY")
    if token and repo:
        r = httpx.post(
            f"https://api.github.com/repos/{repo}/dispatches",
            timeout=10,
            headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"},
            json={"event_type": "retrain", "client_payload": {"reason": reason}},
        )
        r.raise_for_status()
        return "github:repository_dispatch"
    return "none"


@flow(name="monitoring-check", on_failure=[on_flow_failure], log_prints=True)
def monitoring_check(auto_retrain: bool = True) -> dict:
    """Drift check; on drift, alert + retraining (Continuous Training)."""
    summary = drift_check()
    logger = get_run_logger()
    logger.info("drift status: %s (share %.2f, %d predictions)", summary["status"], summary["drift_share"], summary["n_current"])
    if summary["status"] == "drift":
        write_alert("warning", "Dérive détectée", {k: summary.get(k) for k in ("drift_share", "drifted_columns", "mean_confidence")})
        if auto_retrain:
            summary["retraining"] = trigger_retraining("drift")
    return summary


@task
def triage_incoming(incoming: str) -> dict:
    """Valid images (known class folder, readable) go to the dataset; the others go to quarantine."""
    from PIL import Image

    params = load_params()
    raw = ROOT / params["data"]["raw_dir"]
    known = {d.name for d in raw.iterdir() if d.is_dir()} if raw.exists() else set()
    src, quarantine = ROOT / incoming, ROOT / "data" / "quarantine"
    accepted, rejected = 0, []
    for p in sorted(src.rglob("*")) if src.exists() else []:
        if not p.is_file():
            continue
        cls = p.parent.name
        reason = None
        if p.suffix.lower() not in EXTENSIONS:
            reason = "extension"
        elif cls not in known:
            reason = f"unknown class '{cls}'"
        else:
            try:
                with Image.open(p) as im:
                    im.verify()
            except Exception:  # noqa: BLE001
                reason = "corrupt image"
        dest = (quarantine / cls / p.name) if reason else (raw / cls / f"incoming_{p.name}")
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(p), dest)
        if reason:
            rejected.append({"file": str(p.relative_to(ROOT)), "reason": reason})
        else:
            accepted += 1
    if rejected:
        write_alert("warning", "Images mises en quarantaine", {"count": len(rejected), "examples": rejected[:5]})
    return {"accepted": accepted, "rejected": len(rejected)}


@task(retries=2, retry_delay_seconds=[10, 60])
def version_dataset() -> None:
    sh(["dvc", "add", "data/raw/plantvillage"], timeout=3600)


@flow(name="ingest-new-data", on_failure=[on_flow_failure], log_prints=True)
def ingest_new_data(incoming: str = "data/incoming", min_new_images: int = 20, auto_retrain: bool = True) -> dict:
    """New labelled images dropped in data/incoming/<class>/ -> validated, versioned, retraining triggered."""
    result = triage_incoming(incoming)
    logger = get_run_logger()
    logger.info("ingestion: %s", result)
    if result["accepted"] == 0:
        return result
    version_dataset()
    push_artifacts()
    if auto_retrain and result["accepted"] >= min_new_images:
        result["retraining"] = trigger_retraining("new_data")
    return result


if __name__ == "__main__":
    training_pipeline()
