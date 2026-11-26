import os
import tempfile

# keep test predictions out of the real production log / drift files
_tmp = tempfile.mkdtemp(prefix="phytora-test-")
os.environ.setdefault("PREDICTION_LOG", os.path.join(_tmp, "predictions.jsonl"))
os.environ.setdefault("DRIFT_SUMMARY", os.path.join(_tmp, "drift_summary.json"))
