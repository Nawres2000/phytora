# Training / orchestration environment (PyTorch CPU, DVC, MLflow, Prefect, Evidently).
# Used by two compose services: `prefect-server` (Prefect UI + API) and `trainer`
# (serves the flows: training pipeline, drift monitoring, data ingestion).
# Build context = repository root. The repository itself is mounted at /app at run time
# (DVC needs the Git work tree), so the image only contains the dependencies.
FROM python:3.13-slim AS base
ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1 PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
RUN sed -i "s|http://deb.debian.org|https://deb.debian.org|g" /etc/apt/sources.list.d/debian.sources \
 && apt-get update && apt-get install -y --no-install-recommends git curl && rm -rf /var/lib/apt/lists/* \
 && git config --global --add safe.directory /app \
 && git config --global user.email "trainer@phytora.local" && git config --global user.name "PHYTORA trainer"

FROM base AS deps
COPY requirements-train.txt /tmp/requirements-train.txt
RUN pip install -r /tmp/requirements-train.txt

FROM deps AS runtime
WORKDIR /app
ENV PYTHONPATH=/app
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=5 CMD python -c "import prefect, torch, dvc" || exit 1
CMD ["python", "-m", "src.pipelines.serve"]
