#!/usr/bin/env bash
# Deploy a released version (images from the registry, built once by the CD workflow) to an environment.
#   scripts/deploy.sh staging <tag>      # e.g. the commit SHA built by cd.yml
#   scripts/deploy.sh prod <tag>
# If the smoke test fails, the previous version of that environment is redeployed (automatic rollback).
# Windows: run from Git Bash.
set -euo pipefail
ENV=${1:?usage: deploy.sh <dev|staging|prod> <tag>}; TAG=${2:-latest}
REGISTRY=${REGISTRY:-ghcr.io/nawres2000/phytora}
HISTORY=deploy/history.log
mkdir -p deploy
PREVIOUS=$(grep " $ENV " "$HISTORY" 2>/dev/null | grep " ok$" | tail -1 | awk '{print $3}' || true)

run() {
  if [ "$ENV" = "dev" ]; then
    docker compose up -d --build
  else
    REGISTRY=$REGISTRY TAG=$1 docker compose pull backend gateway frontend
    REGISTRY=$REGISTRY TAG=$1 docker compose up -d --no-build backend gateway frontend mongo prometheus grafana
  fi
}

echo "Deploying $ENV <- $REGISTRY:*:$TAG (previous: ${PREVIOUS:-none})"
run "$TAG"
if scripts/smoke_test.sh; then
  echo "$(date -u +%FT%TZ) $ENV $TAG ok" >> "$HISTORY"
  echo "Deployment of $TAG to $ENV succeeded."
else
  echo "$(date -u +%FT%TZ) $ENV $TAG failed" >> "$HISTORY"
  if [ -n "$PREVIOUS" ]; then
    echo "Smoke test failed: rolling back $ENV to $PREVIOUS"
    run "$PREVIOUS"
    scripts/smoke_test.sh && echo "$(date -u +%FT%TZ) $ENV $PREVIOUS ok (rollback)" >> "$HISTORY"
  fi
  exit 1
fi
