from fastapi import APIRouter, Request

from models.schemas import (
    CombinedEmbeddingResponse,
    CombinedRequest,
    EmbeddingResponse,
    ImageRequest,
    TextRequest,
)

router = APIRouter(prefix="/embed", tags=["embeddings"])


@router.post("/text", response_model=EmbeddingResponse)
def embed_text(req: TextRequest, request: Request) -> EmbeddingResponse:
    """Encode a text string into a 512-dim FashionCLIP vector."""
    clip = request.app.state.clip_service
    embedding = clip.encode_text(req.text)
    return EmbeddingResponse(embedding=embedding, dimensions=len(embedding))


@router.post("/image", response_model=EmbeddingResponse)
def embed_image(req: ImageRequest, request: Request) -> EmbeddingResponse:
    """Encode an image (local path or URL) into a 512-dim FashionCLIP vector."""
    clip = request.app.state.clip_service
    embedding = clip.encode_image(req.image_path)
    return EmbeddingResponse(embedding=embedding, dimensions=len(embedding))


@router.post("/combined", response_model=CombinedEmbeddingResponse)
def embed_combined(req: CombinedRequest, request: Request) -> CombinedEmbeddingResponse:
    """
    Full pipeline in one call:
      1. Clean raw caption via LLM (strips hashtags, emojis, mentions)
      2. Encode clean caption + image into a single 512-dim vector

    Falls back to text-only if the image is unavailable.
    Falls back to raw caption if caption cleaning fails.
    """
    clip = request.app.state.clip_service
    caption_service = request.app.state.caption_service

    # Step 1 — clean caption (falls back to raw on failure)
    clean_caption = caption_service.clean(req.caption) if req.caption else ""

    # Step 2 — embed
    text_to_embed = clean_caption or req.caption or ""
    embedding, source = clip.encode_combined(text_to_embed, req.image_path)

    return CombinedEmbeddingResponse(
        embedding=embedding,
        dimensions=len(embedding),
        source=source,
        clean_caption=clean_caption,
        model_version=clip.model_id,
    )
