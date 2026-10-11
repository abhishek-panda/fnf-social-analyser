"""
Dev-only routes for debugging and testing internal pipeline steps.
Not intended for production callers.
"""
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse

from models.schemas import CaptionRequest, CleanCaptionResponse

router = APIRouter(prefix="/__dev", tags=["dev"])


@router.post("/caption/clean", response_model=CleanCaptionResponse)
def clean_caption(req: CaptionRequest, request: Request) -> CleanCaptionResponse:
    """
    Debug endpoint — test caption cleaning in isolation.
    In production, cleaning happens internally inside POST /embed/combined.
    """
    caption_service = request.app.state.caption_service
    clean = caption_service.clean(req.caption)
    return CleanCaptionResponse(
        clean_caption=clean,
        original_caption=req.caption,
    )


@router.get("/embeddings/visualise", response_class=HTMLResponse)
def visualise_embeddings(request: Request) -> HTMLResponse:
    """
    Interactive 3D scatter plot of all post embeddings reduced via UMAP.
    Open in browser: http://localhost:8000/__dev/embeddings/visualise
    Note: takes ~10–30s on first load — UMAP runs on request.
    """
    try:
        html = request.app.state.visualise_service.render()
        return HTMLResponse(content=html, status_code=200)
    except RuntimeError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
