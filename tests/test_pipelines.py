"""Prefect flows: error handling paths, without running real training (stages are mocked)."""

import json

import pytest

flows = pytest.importorskip("src.pipelines.flows")


@pytest.fixture
def fake_root(tmp_path, monkeypatch):
    raw = tmp_path / "data" / "raw" / "plantvillage" / "color"
    for cls in ("A___healthy", "B___rust"):
        (raw / cls).mkdir(parents=True)
        for i in range(12):
            (raw / cls / f"{i}.jpg").write_bytes(b"x")
    (tmp_path / "reports" / "monitoring").mkdir(parents=True)
    monkeypatch.setattr(flows, "ROOT", tmp_path)
    monkeypatch.setattr(flows, "ALERTS", tmp_path / "reports" / "monitoring" / "alerts.jsonl")
    monkeypatch.setattr(flows, "STATUS", tmp_path / "reports" / "pipeline_status.json")
    params = {"data": {"raw_dir": "data/raw/plantvillage/color"}, "pipeline": {"min_test_macro_f1": 0.9}}
    monkeypatch.setattr(flows, "load_params", lambda: params)
    return tmp_path


def test_validate_data_ok_and_too_small_class(fake_root):
    assert flows.validate_data.fn(min_per_class=10) == {"classes": 2, "images": 24}
    with pytest.raises(flows.DataValidationError):
        flows.validate_data.fn(min_per_class=50)


def test_quality_gate(fake_root):
    (fake_root / "reports" / "metrics.json").write_text(json.dumps({"test_macro_f1": 0.95}))
    assert flows.quality_gate.fn(0.9)["test_macro_f1"] == 0.95
    (fake_root / "reports" / "metrics.json").write_text(json.dumps({"test_macro_f1": 0.5}))
    with pytest.raises(flows.QualityGateError):
        flows.quality_gate.fn(0.9)


def test_sh_raises_stage_error_with_output():
    with pytest.raises(flows.StageError, match="exit"):
        flows.sh(["python", "-c", "import sys; print('boom', file=sys.stderr); sys.exit(3)"])


def test_failed_gate_triggers_rollback_and_alert(fake_root, monkeypatch):
    calls = []
    monkeypatch.setattr(flows.sh, "__call__", None, raising=False)
    monkeypatch.setattr(flows, "sh", lambda cmd, timeout=None: calls.append(cmd) or "")
    (fake_root / "reports" / "metrics.json").write_text(json.dumps({"test_macro_f1": 0.42}))
    with pytest.raises(flows.QualityGateError):
        flows.training_pipeline(reason="test", push=False, reload=False)
    stages = [c[-1] for c in calls if c[:2] == ["dvc", "repro"]]
    assert stages == ["prepare", "train", "evaluate"]  # export never ran: the rejected model is not registered
    alerts = (fake_root / "reports" / "monitoring" / "alerts.jsonl").read_text()
    assert "Rollback du modèle" in alerts and "en échec" in alerts


def test_successful_pipeline_runs_all_stages(fake_root, monkeypatch):
    calls = []
    monkeypatch.setattr(flows, "sh", lambda cmd, timeout=None: calls.append(cmd) or "")
    (fake_root / "reports" / "metrics.json").write_text(json.dumps({"test_macro_f1": 0.97, "test_acc": 0.98}))
    status = flows.training_pipeline(reason="test", push=True, reload=False)
    stages = [c[-1] for c in calls if c[:2] == ["dvc", "repro"]]
    assert stages == ["prepare", "train", "evaluate", "export", "reference"]
    assert ["dvc", "push"] in calls and status["test_macro_f1"] == 0.97


def test_ingestion_quarantines_bad_files(fake_root, monkeypatch):
    from PIL import Image

    monkeypatch.setattr(flows, "sh", lambda cmd, timeout=None: "")
    inc = fake_root / "data" / "incoming"
    (inc / "A___healthy").mkdir(parents=True)
    (inc / "Unknown").mkdir()
    Image.new("RGB", (8, 8)).save(inc / "A___healthy" / "good.jpg")
    (inc / "A___healthy" / "broken.jpg").write_bytes(b"not an image")
    Image.new("RGB", (8, 8)).save(inc / "Unknown" / "x.jpg")
    out = flows.ingest_new_data(incoming="data/incoming", auto_retrain=False)
    assert out == {"accepted": 1, "rejected": 2}
    assert (fake_root / "data" / "raw" / "plantvillage" / "color" / "A___healthy" / "incoming_good.jpg").exists()
    assert len(list((fake_root / "data" / "quarantine").rglob("*.jpg"))) == 2


def test_experiment_grid_survives_a_failing_experiment(fake_root, monkeypatch):
    from src.pipelines import experiments

    calls = []

    def fake_sh(cmd, timeout=None):
        calls.append(cmd)
        if cmd[:3] == ["dvc", "exp", "run"] and "broken" in cmd:
            raise flows.StageError("dvc exp run failed (exit 1): CUDA out of memory")
        if cmd[:3] == ["dvc", "exp", "show"]:
            exp = {
                "name": "good",
                "data": {
                    "metrics": {"reports/metrics.json": {"data": {"test_acc": 0.9, "test_macro_f1": 0.88}}},
                    "params": {"params.yaml": {"data": {"train": {"model": "mobilenet_v3_small"}}}},
                },
            }
            return json.dumps([{"rev": "workspace", "experiments": [{"revs": [exp]}]}])
        return ""

    monkeypatch.setattr(experiments, "sh", fake_sh)
    monkeypatch.setattr(experiments, "ROOT", fake_root)
    monkeypatch.setattr(experiments, "write_alert", lambda *a, **k: None)
    out = experiments.experiment_grid(quick_n=10, grid={"good": {"train.model": "mobilenet_v3_small"}, "broken": {"train.model": "x"}})
    assert out["succeeded"] == ["good"] and out["failed"][0]["name"] == "broken"
    assert out["ranking"][0]["test_macro_f1"] == 0.88
    run_cmds = [c for c in calls if c[:3] == ["dvc", "exp", "run"]]
    assert all("--temp" in c for c in run_cmds) and ["-S", "data.quick_n=10"] == run_cmds[0][-2:]
    assert (fake_root / "reports" / "experiments.md").read_text().count("|") > 10
