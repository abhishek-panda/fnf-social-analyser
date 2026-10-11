from fastapi import APIRouter, Request

from models.schemas import HealthResponse

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
def health(request: Request) -> HealthResponse:
    """Service liveness check — returns model and device info."""
    clip = request.app.state.clip_service
    return HealthResponse(
        status="ok",
        clip_model=clip.model_id,
        clip_device=clip.device,
        ollama_model=request.app.state.config.llm_model,
    )
