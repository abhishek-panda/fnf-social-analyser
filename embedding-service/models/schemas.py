from pydantic import BaseModel, field_validator


# ── Request schemas ────────────────────────────────────────────────────────────

class TextRequest(BaseModel):
    text: str

    @field_validator("text")
    @classmethod
    def text_must_not_be_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("text must not be empty")
        return v


class ImageRequest(BaseModel):
    """Accepts a local file path or an http(s) URL."""
    image_path: str

    @field_validator("image_path")
    @classmethod
    def path_must_not_be_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("image_path must not be empty")
        return v


class CombinedRequest(BaseModel):
    """
    Send raw caption + image path.
    embedding-service handles caption cleaning internally before embedding.
    """
    caption: str
    image_path: str


class CaptionRequest(BaseModel):
    caption: str


# ── Response schemas ───────────────────────────────────────────────────────────

class EmbeddingResponse(BaseModel):
    embedding: list[float]
    dimensions: int


class CombinedEmbeddingResponse(EmbeddingResponse):
    source: str         # 'combined' | 'text_only' | 'image_only'
    clean_caption: str  # caption after LLM cleaning
    model_version: str  # exact HuggingFace model ID used to generate the embedding


class CleanCaptionResponse(BaseModel):
    clean_caption: str
    original_caption: str


class HealthResponse(BaseModel):
    status: str
    clip_model: str
    clip_device: str
    ollama_model: str
