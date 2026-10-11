import os
from io import BytesIO

import requests
from fastapi import HTTPException
from PIL import Image


class ImageLoader:
    """
    Single responsibility: load an image from a local path or remote URL.
    Raises HTTPException on failure so callers don't need to handle I/O errors.
    """

    def __init__(self, request_timeout: int = 10) -> None:
        self._timeout = request_timeout

    def load(self, image_path: str) -> Image.Image:
        """Load and return an RGB PIL Image from a path or URL."""
        if self._is_url(image_path):
            return self._load_from_url(image_path)
        return self._load_from_file(image_path)

    def _is_url(self, path: str) -> bool:
        return path.startswith("http://") or path.startswith("https://")

    def _load_from_url(self, url: str) -> Image.Image:
        try:
            response = requests.get(url, timeout=self._timeout)
            response.raise_for_status()
            return Image.open(BytesIO(response.content)).convert("RGB")
        except Exception as exc:
            raise HTTPException(
                status_code=400,
                detail=f"Failed to fetch image from URL: {exc}"
            ) from exc

    def _load_from_file(self, path: str) -> Image.Image:
        if not os.path.exists(path):
            raise HTTPException(
                status_code=400,
                detail=f"Image file not found: {path}"
            )
        return Image.open(path).convert("RGB")
