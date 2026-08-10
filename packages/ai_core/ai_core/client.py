"""Unified LLM client using Google Gemini API."""

from __future__ import annotations

import json
import os
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any

from google import genai
from google.genai import types


CHAT_MODEL = os.environ.get("GEMINI_CHAT_MODEL", "gemini-2.5-flash")
EMBEDDING_MODEL = os.environ.get("GEMINI_EMBEDDING_MODEL", "text-embedding-004")
EMBEDDING_DIMENSIONS = 768


@dataclass
class ChatCompletion:
    """Minimal interface matching our usage of OpenAI's chat completion."""
    content: str


@dataclass
class EmbeddingResponse:
    """Minimal interface matching our usage of OpenAI's embeddings."""
    embedding: list[float]


class GeminiClient:
    """Wrapper around google.genai.Client providing OpenAI-compatible interface."""

    def __init__(self):
        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            raise RuntimeError("GEMINI_API_KEY environment variable not set")
        self._client = genai.Client(api_key=api_key)
        self.chat = self._Chat(self)
        self.completions = self._Completions(self)
        self.embeddings = self._Embeddings(self)

    class _Chat:
        def __init__(self, outer: GeminiClient):
            self._outer = outer
            self.completions = outer._Completions(outer)

    class _Completions:
        def __init__(self, outer: GeminiClient):
            self._outer = outer

        def create(
            self,
            *,
            model: str | None = None,
            messages: list[dict[str, str]],
            response_format: dict[str, Any] | None = None,
            stream: bool = False,
        ) -> ChatCompletion | Iterator[ChatCompletion]:
            model = model or CHAT_MODEL

            system_instruction = None
            contents: list[types.Content] = []
            for msg in messages:
                if msg["role"] == "system":
                    system_instruction = msg["content"]
                else:
                    role = "user" if msg["role"] == "user" else "model"
                    contents.append(types.Content(role=role, parts=[types.Part(text=msg["content"])]))

            config = None
            if response_format:
                schema = response_format.get("json_schema", {}).get("schema")
                if schema:
                    config = types.GenerateContentConfig(
                        response_mime_type="application/json",
                        response_schema=schema,
                        system_instruction=system_instruction,
                    )
            if system_instruction and not config:
                config = types.GenerateContentConfig(system_instruction=system_instruction)

            if stream:
                return self._stream_create(model, contents, config)
            else:
                response = self._outer._client.models.generate_content(
                    model=model,
                    contents=contents,
                    config=config,
                )
                return ChatCompletion(content=response.text or "")

        def _stream_create(
            self,
            model: str,
            contents: list[types.Content],
            config: types.GenerateContentConfig | None,
        ) -> Iterator[ChatCompletion]:
            stream = self._outer._client.models.generate_content_stream(
                model=model,
                contents=contents,
                config=config,
            )
            for chunk in stream:
                if chunk.text:
                    yield ChatCompletion(content=chunk.text)

    class _Embeddings:
        def __init__(self, outer: GeminiClient):
            self._outer = outer

        def create(
            self,
            *,
            model: str | None = None,
            input: str | list[str],
            dimensions: int | None = None,
        ) -> EmbeddingResponse:
            model = model or EMBEDDING_MODEL
            texts = input if isinstance(input, list) else [input]

            response = self._outer._client.models.embed_content(
                model=model,
                contents=texts,
                config=types.EmbedContentConfig(output_dimensionality=dimensions or EMBEDDING_DIMENSIONS),
            )
            return EmbeddingResponse(embedding=response.embeddings[0].values)


def get_client() -> GeminiClient:
    """Get a configured Gemini client instance."""
    return GeminiClient()