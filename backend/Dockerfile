# Model API image (build context = repository root, it needs src/ for the shared model code)
# Stage 1: install the Python dependencies into a virtualenv
FROM python:3.13-slim AS builder
ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
RUN python -m venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH
COPY backend/requirements.txt backend/requirements-explain.txt /tmp/
# WITH_TORCH=0 gives a ~4x smaller image without Grad-CAM (ONNX Runtime only)
ARG WITH_TORCH=1
RUN pip install -r /tmp/requirements.txt \
 && if [ "$WITH_TORCH" = "1" ]; then pip install -r /tmp/requirements-explain.txt; fi

# Stage 2: slim runtime, non-root user, only the code the API imports
FROM python:3.13-slim AS runtime
ENV PATH=/opt/venv/bin:$PATH PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 MODEL_DIR=/app/models/legacy
RUN useradd --create-home --uid 1001 app
COPY --from=builder /opt/venv /opt/venv
WORKDIR /app
COPY src/__init__.py src/
COPY src/utils src/utils
COPY src/models/__init__.py src/models/architecture.py src/models/checkpoint.py src/models/
COPY backend/__init__.py backend/
COPY backend/app backend/app
USER app
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4)"
CMD ["uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8000"]
