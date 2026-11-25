"""Pydantic schemas: every response of the API is validated against one of these models
(and documented automatically in Swagger at /docs)."""

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", protected_namespaces=())


class GPUInfo(Strict):
    available: bool = Field(description="A CUDA device is visible to the inference engine")
    name: Optional[str] = None
    providers: list[str] = Field(description="ONNX Runtime execution providers in use")


class HealthResponse(Strict):
    status: Literal["ok", "degraded"]
    model_loaded: bool
    model_version: Optional[str] = None
    engine: Optional[Literal["onnxruntime", "pytorch", "mock"]] = None
    variant: Optional[str] = Field(None, description="Served model file: fp32, int8 or fp16 ONNX")
    explain_available: bool = Field(description="Grad-CAM / Score-CAM available (needs PyTorch and the checkpoint)")
    gpu: GPUInfo
    mock: bool = False
    uptime_s: float
    error: Optional[str] = None
    min_confidence: float
    min_margin: float


class VariantInfo(BaseModel):
    model_config = ConfigDict(extra="allow")
    file: str
    size_mb: Optional[float] = None
    latency_ms: Optional[dict] = None
    acc: Optional[float] = None
    macro_f1: Optional[float] = None
    agreement_with_fp32: Optional[float] = None
    error: Optional[str] = None


class MetadataResponse(BaseModel):
    model_config = ConfigDict(extra="allow", protected_namespaces=())
    name: str
    architecture: str
    version: str
    task: str
    framework: str
    num_classes: int
    classes: list[str]
    img_size: int
    input: dict
    output: dict
    metrics: dict = Field(description="Validation / test metrics of the served checkpoint")
    benchmark: dict = Field(default_factory=dict, description="Baseline vs advanced model comparison")
    variants: dict[str, VariantInfo] = Field(default_factory=dict, description="FP32 / INT8 / FP16 ONNX benchmark")
    serve_variant: str
    engine: str
    thresholds: dict


class Candidate(Strict):
    class_id: str = Field(examples=["Tomato___Late_blight"])
    plant: str = Field(examples=["Tomato"])
    condition: str = Field(examples=["Late blight"])
    healthy: bool
    score: float = Field(ge=0, le=1)


class Severity(Strict):
    percent: Optional[float] = Field(None, description="Share of the leaf surface with symptoms (colour heuristic)")
    level: str = Field(examples=["modérée"])
    leaf_coverage: float = Field(description="Share of the image covered by the leaf")


class Latency(Strict):
    preprocess_ms: float
    inference_ms: float
    explain_ms: float = 0.0
    total_ms: float


class PredictionResponse(Strict):
    class_id: str
    confidence: float = Field(ge=0, le=1)
    top_k: list[Candidate]
    uncertain: bool = Field(description="Confidence < MIN_CONFIDENCE or top-1/top-2 margin < MIN_MARGIN")
    severity: Optional[Severity] = None
    heatmap: Optional[str] = Field(None, description="Grad-CAM overlay as a JPEG data URL (explain=true)")
    explain_method: Optional[str] = None
    latency: Latency
    latency_ms: float = Field(description="Server-side processing time (= latency.total_ms)")
    model_version: Optional[str] = None
    engine: str
    variant: Optional[str] = None
    mock: bool = False


class BatchItem(Strict):
    filename: Optional[str] = None
    prediction: Optional[PredictionResponse] = None
    error: Optional[str] = None


class BatchResponse(Strict):
    count: int
    items: list[BatchItem]
    latency_ms: float


class ErrorResponse(BaseModel):
    detail: str
