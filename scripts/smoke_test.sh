#!/usr/bin/env bash
# Post-deployment smoke test: exits non-zero if the deployed stack is not healthy.
# usage: scripts/smoke_test.sh [api_url] [gateway_url] [frontend_url]
set -euo pipefail
API=${1:-http://localhost:8000}; GATEWAY=${2:-http://localhost:5000}; WEB=${3:-http://localhost:3000}
IMG=${SMOKE_IMAGE:-frontend/public/examples/feuille.jpg}

wait_for() { for i in $(seq 1 60); do curl -fsS "$1" > /dev/null 2>&1 && return 0; sleep 3; done; echo "TIMEOUT $1"; return 1; }
check() { echo "  - $1"; }

echo "Smoke test on $API"
wait_for "$API/health"; wait_for "$GATEWAY/health"; wait_for "$WEB"
curl -fsS "$API/health" | grep -q '"model_loaded":true' && check "model loaded"
curl -fsS "$API/model/metadata" > /dev/null && check "metadata"
start=$(date +%s%N)
curl -fsS -F "file=@$IMG;type=image/jpeg" "$API/predict" | grep -q '"class_id"' && check "prediction"
ms=$(( ($(date +%s%N) - start) / 1000000 ))
check "prediction latency ${ms} ms"
[ "$ms" -lt "${MAX_LATENCY_MS:-5000}" ] || { echo "latency too high"; exit 1; }
code=$(curl -s -o /dev/null -w '%{http_code}' -F 'file=@README.md;type=text/plain' "$API/predict")
[ "$code" = "400" ] && check "non-image rejected (400)"
curl -fsS "$API/metrics" | grep -q phytora_http_requests_total && check "prometheus metrics"
echo "SMOKE TEST PASSED"
