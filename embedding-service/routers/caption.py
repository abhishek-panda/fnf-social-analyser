from fastapi import APIRouter, Request

from models.schemas import CaptionRequest, CleanCaptionResponse

router = APIRouter(prefix="/caption", tags=["caption"])


@router.post("/clean", response_model=CleanCaptionResponse)
def clean_caption(req: CaptionRequest, request: Request) -> CleanCaptionResponse:
    """
    Extract fashion-relevant content from a raw Instagram caption using a local LLM.
    Removes hashtags, mentions, URLs, emojis, and promotional language.
    """
    caption_service = request.app.state.caption_service
    clean = caption_service.clean(req.caption)
    return CleanCaptionResponse(
        clean_caption=clean,
        original_caption=req.caption,
    )
