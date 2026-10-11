import os
from dataclasses import dataclass

# HF_HUB_OFFLINE is read directly by the transformers/huggingface_hub libraries.
# Set to "1" in .env after the model is downloaded to prevent network calls on startup.


@dataclass(frozen=True)
class Config:
    """Immutable application configuration loaded from environment variables."""

    # FashionCLIP
    clip_model_id: str
    clip_device: str

    # LLM (Ollama via OpenAI-compatible API)
    openai_base_url: str
    openai_api_key: str
    llm_model: str
    llm_timeout: int

    # Media
    media_path: str

    # Database
    db_host: str
    db_port: int
    db_name: str
    db_user: str
    db_password: str
    database_url: str

    # Server
    host: str
    port: int


def _detect_device() -> str:
    """Auto-detect the best available compute device."""
    try:
        import torch
        if torch.backends.mps.is_available():
            return "mps"
        if torch.cuda.is_available():
            return "cuda"
    except ImportError:
        pass
    return "cpu"


def load_config() -> Config:
    """Load and validate configuration from environment variables."""
    return Config(
        clip_model_id=os.environ.get("CLIP_MODEL_ID", "patrickjohncyh/fashion-clip"),
        clip_device=os.environ.get("CLIP_DEVICE", _detect_device()),
        openai_base_url=os.environ.get("OPENAI_BASE_URL", "http://localhost:11434/v1"),
        openai_api_key=os.environ.get("OPENAI_API_KEY", "ollama"),
        llm_model=os.environ.get("LLM_MODEL", "llama3.2:3b"),
        llm_timeout=int(os.environ.get("LLM_TIMEOUT", "30")),
        media_path=os.environ.get("MEDIA_PATH", "./media"),
        db_host=(_db_host := os.environ.get("DB_HOST", "localhost")),
        db_port=(_db_port := int(os.environ.get("DB_PORT", "5432"))),
        db_name=(_db_name := os.environ.get("DB_NAME", "fnf_social_analyser")),
        db_user=(_db_user := os.environ.get("DB_USER", "postgres")),
        db_password=(_db_password := os.environ.get("DB_PASSWORD", "postgres")),
        database_url=f"postgresql://{_db_user}:{_db_password}@{_db_host}:{_db_port}/{_db_name}",
        host=os.environ.get("HOST", "0.0.0.0"),
        port=int(os.environ.get("EMBEDDING_SERVICE_PORT", "8000")),
    )
