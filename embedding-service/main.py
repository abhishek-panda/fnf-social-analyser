"""
Embedding Service — entry point.

Wires configuration, services, and routers together.
All business logic lives in services/. All HTTP logic lives in routers/.
"""
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncGenerator

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

# Load root .env — two levels up from embedding-service/
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from config import load_config
from routers import dev, embed, health
from services.caption_service import CaptionService
from services.clip_service import CLIPService
from services.image_loader import ImageLoader
from services.visualise_service import VisualiseService


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """
    Initialise services once at startup and store on app.state.
    FastAPI's lifespan replaces the old @app.on_event("startup") pattern.
    """
    config = load_config()
    app.state.config = config
    app.state.clip_service = CLIPService(config, ImageLoader())
    app.state.caption_service = CaptionService(config)
    app.state.visualise_service = VisualiseService(config)
    yield
    # Teardown (if needed in future)


def create_app() -> FastAPI:
    config = load_config()
    app = FastAPI(
        title="Embedding Service",
        description="FashionCLIP embeddings + Ollama caption cleaning for FNF social posts.",
        version="1.0.0",
        lifespan=lifespan,
    )
    app.include_router(health.router)
    app.include_router(embed.router)
    app.include_router(dev.router)
    # Serve post images for the /__dev/embeddings/visualise hover panel
    # image_path stores filename only (e.g. 17888291706617649.jpg) — images live in MEDIA_PATH/instagram/
    instagram_media = os.path.join(config.media_path, "instagram")
    app.mount("/__dev/media", StaticFiles(directory=instagram_media), name="media")
    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn

    _config = load_config()
    uvicorn.run("main:app", host=_config.host, port=_config.port, reload=True)
