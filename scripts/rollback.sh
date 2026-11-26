#!/usr/bin/env bash
# Manual rollback: redeploy the last successful version before the current one.
#   scripts/rollback.sh prod
set -euo pipefail
ENV=${1:?usage: rollback.sh <staging|prod>}
mapfile -t OK < <(grep " $ENV " deploy/history.log | grep " ok" | awk '{print $3}')
[ "${#OK[@]}" -ge 2 ] || { echo "No previous successful deployment for $ENV"; exit 1; }
TARGET=${OK[-2]}
echo "Rolling back $ENV to $TARGET"
exec scripts/deploy.sh "$ENV" "$TARGET"
