"""Stage `export`: PyTorch checkpoint -> ONNX (FP32) -> INT8 (static, QDQ) and FP16 variants,
benchmark of every variant, serving metadata, MLflow Model Registry.

- FP32 parity with PyTorch is asserted (max |logit diff| < 1e-3, same top-1).
- INT8: static quantization calibrated on TRAIN images (never on test), per-channel weights.
- Each variant is compared on the test split (accuracy, macro-F1, agreement with FP32),
  plus file size and single-image CPU latency.
- models/metadata.json is what the API serves on GET /model/metadata.
- MLflow: the ONNX model is logged to the training run and registered as a new version of
  `phytora-classifier` with alias "staging"; it is promoted to "production" (alias + legacy stage)
  only if its test macro-F1 beats the current production version.

Usage:
  python -m src.models.export                      # after train/evaluate (DVC stage)
  python -m src.models.export --checkpoint models/legacy/mobilenet_v3_small_best.pt \
      --out models/legacy --images path/to/class_folders --no-mlflow
"""

import argparse
import platform
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
import pandas as pd
import torch
from PIL import Image
from sklearn.metrics import accuracy_score, f1_score

from src.models.checkpoint import load_checkpoint
from src.utils.common import EXTENSIONS, ROOT, load_json, load_params, save_json, setup_mlflow


# ---------------------------------------------------------------- preprocessing (identical to the API)
def preprocess(img: Image.Image, size: int, mean, std) -> np.ndarray:
    img = img.convert("RGB").resize((size, size), Image.BILINEAR)
    arr = (np.asarray(img, dtype=np.float32) / 255.0 - np.array(mean, np.float32)) / np.array(std, np.float32)
    return arr.transpose(2, 0, 1)[None].astype(np.float32)


def image_list(params, images_dir, classes, split):
    """[(path, class_idx or -1)] from the DVC split CSVs, or from a folder of class sub-folders."""
    if images_dir:
        out = []
        for d in sorted(Path(images_dir).iterdir()):
            if d.is_dir():
                idx = classes.index(d.name) if d.name in classes else -1
                out += [(p, idx) for p in sorted(d.iterdir()) if p.suffix.lower() in EXTENSIONS]
        return out
    csv = ROOT / params["data"]["processed_dir"] / f"{split}.csv"
    if not csv.exists():
        return []
    df = pd.read_csv(csv)
    raw = ROOT / params["data"]["raw_dir"]
    return [(raw / p, int(c)) for p, c in zip(df["path"], df["class_idx"])]


# ---------------------------------------------------------------- export + variants
def export_onnx(model, size, path: Path, opset: int):
    dummy = torch.randn(1, 3, size, size)
    kwargs = dict(
        input_names=["input"], output_names=["logits"], opset_version=opset, dynamic_axes={"input": {0: "batch"}, "logits": {0: "batch"}}
    )
    errors = []
    for extra in ({"dynamo": False}, {}):  # classic exporter first, then the dynamo one
        try:
            torch.onnx.export(model, dummy, str(path), **kwargs, **extra)
            onnx.checker.check_model(onnx.load(str(path)))
            return
        except Exception as e:  # noqa: BLE001
            errors.append(f"{extra}: {type(e).__name__}: {str(e)[:200]}")
    raise RuntimeError("ONNX export failed: " + " | ".join(errors))


class _Calibration:
    """onnxruntime CalibrationDataReader over a list of preprocessed images."""

    def __init__(self, arrays):
        self.it = iter([{"input": a} for a in arrays])

    def get_next(self):
        return next(self.it, None)


def quantize_int8(fp32: Path, out: Path, calib_arrays, probe: np.ndarray, target_agreement: float = 0.98):
    """Sensitivity-guided mixed-precision static INT8 quantization.

    Naive full INT8 destroys MobileNetV3 (accuracy ~4 %): BatchNorm folding leaves a few early
    channels with huge ranges, and one activation scale per tensor then crushes all the others.
    So: (1) quantize each Conv/Gemm alone and measure how far its logits drift from FP32;
    (2) keep the most sensitive layers in FP32, adding them back one by one (most sensitive first)
    until top-1 agreement with FP32 on the probe batch reaches `target_agreement`.
    """
    import onnx as _onnx
    from onnxruntime.quantization import QuantFormat, QuantType, quantize_static
    from onnxruntime.quantization.shape_inference import quant_pre_process

    pre = out.with_suffix(".pre.onnx")
    tmp = out.with_suffix(".tmp.onnx")
    quant_pre_process(str(fp32), str(pre), skip_symbolic_shape=True)
    common = dict(quant_format=QuantFormat.QDQ, per_channel=True, activation_type=QuantType.QUInt8, weight_type=QuantType.QInt8)

    ref = session(pre).run(None, {"input": probe})[0]
    nodes = [n.name for n in _onnx.load(str(pre)).graph.node if n.op_type in ("Conv", "Gemm")]
    sens_calib = calib_arrays[:32]
    sensitivity = {}
    for n in nodes:
        quantize_static(str(pre), str(tmp), _Calibration(sens_calib), nodes_to_quantize=[n], **common)
        sensitivity[n] = float(np.abs(session(tmp).run(None, {"input": probe})[0] - ref).mean())
    ranked = sorted(nodes, key=lambda n: -sensitivity[n])

    tried = []
    for k in (0, 1, 2, 4, 6, 8, 12, 16, 24, 32, len(ranked)):
        excluded = ranked[:k]
        quantize_static(
            str(pre), str(out), _Calibration(calib_arrays), op_types_to_quantize=["Conv", "Gemm"], nodes_to_exclude=excluded, **common
        )
        agreement = float((session(out).run(None, {"input": probe})[0].argmax(1) == ref.argmax(1)).mean())
        tried.append({"fp32_layers": k, "agreement_with_fp32": round(agreement, 4)})
        if agreement >= target_agreement:
            break
    pre.unlink(missing_ok=True)
    tmp.unlink(missing_ok=True)
    return {
        "method": "static QDQ, per-channel INT8 weights, UINT8 activations, MinMax calibration on train images",
        "layers_total": len(nodes),
        "layers_kept_fp32": excluded,
        "search": tried,
        "most_sensitive": [{"layer": n, "mean_abs_logit_drift": round(sensitivity[n], 4)} for n in ranked[:8]],
    }


def convert_fp16(fp32: Path, out: Path):
    from onnxruntime.transformers.float16 import convert_float_to_float16

    onnx.save(convert_float_to_float16(onnx.load(str(fp32)), keep_io_types=True), str(out))


def session(path: Path):
    so = ort.SessionOptions()
    so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    return ort.InferenceSession(str(path), so, providers=["CPUExecutionProvider"])


def bench(fn, n=50, warmup=5):
    for _ in range(warmup):
        fn()
    times = []
    for _ in range(n):
        t0 = time.perf_counter()
        fn()
        times.append((time.perf_counter() - t0) * 1000)
    return {"mean_ms": round(float(np.mean(times)), 2), "p95_ms": round(float(np.percentile(times, 95)), 2)}


def evaluate_variant(sess, arrays, labels, ref_pred=None):
    """`arrays` is an iterable of preprocessed images (a generator: the test set is never held in memory)."""
    preds = np.array([int(sess.run(None, {"input": a})[0].argmax()) for a in arrays])
    out = {"images": len(preds)}
    known = labels >= 0
    if known.any():
        out["acc"] = round(float(accuracy_score(labels[known], preds[known])), 4)
        out["macro_f1"] = round(float(f1_score(labels[known], preds[known], average="macro", zero_division=0)), 4)
    if ref_pred is not None:
        out["agreement_with_fp32"] = round(float((preds == ref_pred).mean()), 4)
    return out, preds


# ---------------------------------------------------------------- MLflow registry
def register(params, run_id, onnx_path, test_f1):
    mlflow = setup_mlflow(params["mlflow"]["experiment"])
    from mlflow.tracking import MlflowClient

    name = params["mlflow"]["registered_model"]
    with mlflow.start_run(run_id=run_id):
        mlflow.onnx.log_model(onnx.load(str(onnx_path)), name="onnx_model")
        mlflow.log_artifact(str(onnx_path.parent / "metadata.json"), "serving")
    version = mlflow.register_model(f"runs:/{run_id}/onnx_model", name)
    client = MlflowClient()
    client.set_registered_model_alias(name, "staging", version.version)
    _legacy_stage(client, name, version.version, "Staging")

    promote, current = True, None
    try:
        prod = client.get_model_version_by_alias(name, "production")
        current = client.get_run(prod.run_id).data.metrics.get("test_macro_f1")
        promote = test_f1 is not None and (current is None or test_f1 > current)
    except Exception:  # noqa: BLE001  (no production version yet)
        pass
    if promote:
        client.set_registered_model_alias(name, "production", version.version)
        _legacy_stage(client, name, version.version, "Production")
    print(f"Registered {name} v{version.version}: staging" + (" -> production" if promote else f" (production kept, F1 {current})"))
    return {"name": name, "version": int(version.version), "production": promote}


def _legacy_stage(client, name, version, stage):
    """Stages are deprecated in MLflow 3 (aliases replace them) but still shown in the UI when supported."""
    try:
        client.transition_model_version_stage(name, version, stage, archive_existing_versions=(stage == "Production"))
    except Exception:  # noqa: BLE001
        pass


# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", default=str(ROOT / "models" / "model.pt"))
    ap.add_argument("--out", default=str(ROOT / "models"))
    ap.add_argument("--images", help="folder of class sub-folders (when the DVC splits are not available)")
    ap.add_argument("--no-mlflow", action="store_true")
    args = ap.parse_args()

    params = load_params()
    e = params["export"]
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    torch.set_num_threads(max(1, (torch.get_num_threads())))

    model, meta = load_checkpoint(args.checkpoint)
    classes, size, mean, std = meta["classes"], int(meta["img_size"]), meta["mean"], meta["std"]

    rng = np.random.default_rng(params["seed"])
    if args.images:  # one folder: disjoint halves for calibration and evaluation
        pool = image_list(params, args.images, classes, "")
        order = rng.permutation(len(pool))
        calib, test = [pool[i] for i in order[: len(pool) // 2]], [pool[i] for i in order[len(pool) // 2 :]]
    else:
        calib = image_list(params, None, classes, "train")
        test = image_list(params, None, classes, "test")
    if calib:
        pick = rng.choice(len(calib), size=min(e["calibration_images"], len(calib)), replace=False)
        calib_arrays = [preprocess(Image.open(calib[i][0]), size, mean, std) for i in pick]
    else:
        print("WARNING: no images found, INT8 calibration uses random tensors (accuracy not representative)")
        calib_arrays = [rng.standard_normal((1, 3, size, size), dtype=np.float32) for _ in range(16)]
    if e.get("eval_images") and len(test) > e["eval_images"]:
        test = [test[i] for i in rng.choice(len(test), size=e["eval_images"], replace=False)]

    def test_arrays():  # streamed: preprocessing again per variant is cheaper than keeping ~8k images in RAM
        return (preprocess(Image.open(p), size, mean, std) for p, _ in test)

    test_labels = np.array([c for _, c in test])

    # 1) FP32 + parity with PyTorch
    fp32 = out / "model.onnx"
    export_onnx(model, size, fp32, e["opset"])
    probe = np.concatenate([preprocess(Image.open(p), size, mean, std) for p, _ in test[:16]] or calib_arrays[:16])
    with torch.no_grad():
        ref = model(torch.from_numpy(probe)).numpy()
    s32 = session(fp32)
    got = s32.run(None, {"input": probe})[0]
    parity = {
        "max_abs_logit_diff": float(np.abs(ref - got).max()),
        "same_top1": bool((ref.argmax(1) == got.argmax(1)).all()),
        "images": int(len(probe)),
    }
    assert parity["max_abs_logit_diff"] < 1e-3 and parity["same_top1"], f"ONNX export not faithful: {parity}"

    x1 = probe[:1]
    with torch.no_grad():
        torch_latency = bench(lambda: model(torch.from_numpy(x1)))

    variants = {}
    files = {"fp32": fp32}
    quantization = None
    if e["int8"]:
        files["int8"] = out / "model.int8.onnx"
        # probe batch for the sensitivity search: calibration (train) images, never test images
        sens_probe = np.concatenate(calib_arrays[-32:])
        quantization = quantize_int8(fp32, files["int8"], calib_arrays, sens_probe)
        print("INT8:", len(quantization["layers_kept_fp32"]), "of", quantization["layers_total"], "layers kept in FP32")
    if e["fp16"]:
        files["fp16"] = out / "model.fp16.onnx"
        convert_fp16(fp32, files["fp16"])

    ref_pred = None
    for name, path in files.items():
        try:
            sess = s32 if name == "fp32" else session(path)
            info = {
                "file": path.name,
                "size_mb": round(path.stat().st_size / 1e6, 2),
                "latency_ms": bench(lambda: sess.run(None, {"input": x1})),
            }
            if test:
                metrics, preds = evaluate_variant(sess, test_arrays(), test_labels, ref_pred)
                info.update(metrics)
                if name == "fp32":
                    ref_pred = preds
            variants[name] = info
        except Exception as ex:  # noqa: BLE001  (e.g. an op without FP16 kernel on this CPU)
            variants[name] = {"file": path.name, "error": f"{type(ex).__name__}: {str(ex)[:200]}"}
        print(name, variants[name])

    # metrics of the checkpoint: DVC reports, or the legacy metrics.json next to it
    reports = ROOT / "reports"
    ck_dir = Path(args.checkpoint).parent
    train_info = load_json(reports / "train.json") if (reports / "train.json").exists() and not args.images else {}
    test_metrics = load_json(reports / "metrics.json") if (reports / "metrics.json").exists() and not args.images else {}
    benchmark = load_json(ck_dir / "metrics.json") if (ck_dir / "metrics.json").exists() else {}
    if not test_metrics and meta["model"] in benchmark:
        test_metrics = benchmark[meta["model"]]

    serve = e["serve_variant"] if "error" not in variants.get(e["serve_variant"], {"error": 1}) else "fp32"
    metadata = {
        "name": "PHYTORA leaf disease classifier",
        "architecture": meta["model"],
        "version": f"{meta['model']}-ep{meta.get('epoch', '?')}-valF1-{meta.get('best_val_macro_f1', 0):.3f}",
        "task": "image classification (38 PlantVillage classes)",
        "framework": f"PyTorch {torch.__version__} -> ONNX opset {e['opset']} -> ONNX Runtime {ort.__version__}",
        "input": {
            "name": "input",
            "shape": ["batch", 3, size, size],
            "layout": "NCHW",
            "channel_order": "RGB",
            "resize": "bilinear",
            "scale": "1/255",
            "mean": mean,
            "std": std,
        },
        "output": {"name": "logits", "activation": "softmax applied by the API"},
        "num_classes": len(classes),
        "classes": classes,
        "img_size": size,
        "best_epoch": meta.get("epoch"),
        "metrics": {
            "best_val_macro_f1": meta.get("best_val_macro_f1"),
            **test_metrics,
            **{k: v for k, v in train_info.items() if k in ("n_params", "train_seconds")},
        },
        "benchmark": benchmark,
        "parity_pytorch_onnx": parity,
        "latency_pytorch_ms": torch_latency,
        "variants": variants,
        "int8_quantization": quantization,
        "serve_variant": serve,
        "checkpoint": Path(args.checkpoint).name if Path(args.checkpoint).parent.resolve() == out.resolve() else None,
        "mlflow_run_id": meta.get("mlflow_run_id"),
        "exported_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "cpu": platform.processor() or platform.machine(),
    }
    save_json(metadata, out / "metadata.json")
    if out == ROOT / "models":
        save_json({"parity": parity, "torch_latency_ms": torch_latency, "variants": variants}, reports / "export.json")

    if not args.no_mlflow and meta.get("mlflow_run_id"):
        try:
            reg = register(params, meta["mlflow_run_id"], fp32, test_metrics.get("test_macro_f1"))
            metadata["registry"] = reg
            save_json(metadata, out / "metadata.json")
        except Exception as ex:  # noqa: BLE001
            print("MLflow registry skipped:", ex)
    print("Wrote", out / "metadata.json", "| serving variant:", serve)


if __name__ == "__main__":
    main()
