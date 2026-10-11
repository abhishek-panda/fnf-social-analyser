from fastapi import HTTPException
from openai import OpenAI, APIConnectionError, APITimeoutError, APIStatusError

from config import Config

_SYSTEM_PROMPT = (
    "You are a fashion product assistant. Extract fashion-relevant descriptions from Instagram captions.\n\n"
    "Rules:\n"
    "- Return ONLY clothing items, colours, materials, styles, fit, and size information\n"
    "- Remove ALL emojis, hashtags (#), mentions (@), URLs, ad/gifted/sponsored disclosures, and non-fashion phrases\n"
    "- The output must contain ONLY plain text — no emoji characters whatsoever\n"
    "- If multiple clothing items are mentioned, list them separated by commas\n"
    "- If absolutely nothing is fashion-related, return exactly: NONE\n"
    "- NEVER invent or assume clothing details not explicitly stated in the caption\n"
    "- Return only the extracted description, nothing else\n\n"
    "Examples:\n"
    "Caption: 'Sunday morning walks wearing my fave oversized shacket from Tesco #fashion #ootd'\n"
    "Output: oversized shacket\n\n"
    "Caption: 'keyhole jumpsuit, £25 #FandFClothing'\n"
    "Output: keyhole jumpsuit\n\n"
    "Caption: 'sequined green mini dress with v neck and tie-waist, £29'\n"
    "Output: sequined green mini dress, v neck, tie-waist\n\n"
    "Caption: 'Ahh you make my cheeks hurt - love you loads little man. how are you 4 months old today?! romper is @hm - kindly gifted! #hmkids #fandfclothing #mumlife'\n"
    "Output: NONE\n\n"
    "Caption: 'happy friday everyone!! #weekend #vibes'\n"
    "Output: NONE\n\n"
    "Caption: 'obsessed with this size 10 rust floral midi skirt #fandfclothing #ootd ad'\n"
    "Output: rust floral midi skirt, size 10"
)


class CaptionService:
    """
    Single responsibility: clean Instagram captions using a local LLM.

    Uses the OpenAI-compatible client pointed at Ollama by default.
    Swappable to any OpenAI-compatible provider via OPENAI_BASE_URL + OPENAI_API_KEY env vars.
    """

    def __init__(self, config: Config) -> None:
        self._config = config
        self._client = OpenAI(
            base_url=config.openai_base_url,
            api_key=config.openai_api_key,
            timeout=config.llm_timeout,
        )

    def clean(self, caption: str) -> str:
        """
        Extract fashion-relevant content from a raw Instagram caption.
        Returns an empty string if the caption has no relevant content.
        Raises HTTPException on LLM connectivity or timeout errors.
        """
        if not caption or not caption.strip():
            return ""

        try:
            response = self._client.chat.completions.create(
                model=self._config.llm_model,
                messages=[
                    {"role": "system", "content": _SYSTEM_PROMPT},
                    {"role": "user", "content": caption.strip()},
                ],
                temperature=0.1,
                max_tokens=2048,  # thinking models need room to reason before answering
            )
            result = (response.choices[0].message.content or "").strip()
            return "" if result.upper() == "NONE" else result

        except APIConnectionError as exc:
            raise HTTPException(
                status_code=503,
                detail=f"LLM not reachable at {self._config.openai_base_url}"
            ) from exc
        except APITimeoutError as exc:
            raise HTTPException(
                status_code=504,
                detail=f"LLM timed out after {self._config.llm_timeout}s"
            ) from exc
        except APIStatusError as exc:
            raise HTTPException(
                status_code=502,
                detail=f"LLM returned error {exc.status_code}: {exc.message}"
            ) from exc
