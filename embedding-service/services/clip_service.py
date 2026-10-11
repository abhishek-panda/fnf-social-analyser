import os

import torch
import torch.nn.functional as F
from PIL import Image
from transformers import AutoModel, AutoProcessor

from config import Config
from services.image_loader import ImageLoader


class CLIPService:
    """
    Single responsibility: generate embeddings using a CLIP-compatible vision-language model.

    Supports FashionCLIP, OpenAI CLIP, and SigLIP via AutoModel/AutoProcessor.
    Model is configured via CLIP_MODEL_ID env var.
    Loaded once at startup — stateless after initialisation.
    """

    def __init__(self, config: Config, image_loader: ImageLoader) -> None:
        self._config = config
        self._image_loader = image_loader
        self._device = config.clip_device
        self._model, self._processor = self._load_model()

    # ── Public API ─────────────────────────────────────────────────────────────

    @property
    def model_id(self) -> str:
        return self._config.clip_model_id

    @property
    def device(self) -> str:
        return self._device

    def encode_text(self, text: str) -> list[float]:
        """Encode a text string into a normalised 512-dim vector."""
        max_length = getattr(self._model.config.text_config, "max_position_embeddings", 77)
        inputs = self._processor(
            text=[text],
            return_tensors="pt",
            padding="max_length",
            truncation=True,
            max_length=max_length,
        ).to(self._device)

        with torch.no_grad():
            outputs = self._model.get_text_features(**inputs)

        return self._to_vector(outputs)

    def encode_image(self, image_path: str) -> list[float]:
        """Load an image and encode it into a normalised 512-dim vector."""
        image = self._image_loader.load(image_path)
        return self._encode_pil_image(image)

    def encode_combined(self, text: str, image_path: str) -> tuple[list[float], str]:
        """
        Encode text and image then average their embeddings.
        Falls back to text-only if the image is unavailable.

        Returns:
            (embedding, source) where source is 'combined' or 'text_only'.
        """
        text_emb = self.encode_text(text)

        try:
            image_emb = self.encode_image(image_path)
            return self._average(text_emb, image_emb), "combined"
        except Exception:
            return text_emb, "text_only"

    # ── Private ────────────────────────────────────────────────────────────────

    def _load_model(self) -> tuple[AutoModel, AutoProcessor]:
        print(f"Loading model ({self._config.clip_model_id})...")
        # Derive Python SSL vars from NODE_EXTRA_CA_CERTS (single source of truth in .env)
        ca_cert = os.environ.get("NODE_EXTRA_CA_CERTS")
        if ca_cert:
            os.environ["SSL_CERT_FILE"] = ca_cert
            os.environ["REQUESTS_CA_BUNDLE"] = ca_cert
            os.environ["CURL_CA_BUNDLE"] = ca_cert
        model = AutoModel.from_pretrained(self._config.clip_model_id)
        processor = AutoProcessor.from_pretrained(self._config.clip_model_id)
        model.eval()
        model = model.to(self._device)
        print(f"Model loaded on device: {self._device}")
        return model, processor

    def _encode_pil_image(self, image: Image.Image) -> list[float]:
        inputs = self._processor(images=image, return_tensors="pt").to(self._device)
        with torch.no_grad():
            outputs = self._model.get_image_features(**inputs)
        return self._to_vector(outputs)

    def _to_vector(self, outputs: object) -> list[float]:
        """Extract and normalise a tensor from model output."""
        tensor = outputs if isinstance(outputs, torch.Tensor) else outputs.pooler_output
        normalised = F.normalize(tensor.float(), dim=-1)
        return normalised[0].cpu().tolist()

    def _average(self, a: list[float], b: list[float]) -> list[float]:
        """Average two vectors and renormalise."""
        ta = torch.tensor(a)
        tb = torch.tensor(b)
        return F.normalize((ta + tb) / 2, dim=-1).tolist()
