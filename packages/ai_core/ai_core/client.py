"""Unified LLM client using Google Gemini API."""

from __future__ import annotations

import os
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any

from google import genai
from google.genai import types


CHAT_MODEL = os.environ.get("GEMINI_CHAT_MODEL", "gemini-2.5-flash")
# text-embedding-004 (the original default) has been retired - confirmed
# live via ListModels against the real API, embedContent is now only
# served by the gemini-embedding-* family. gemini-embedding-001 is the
# stable one (vs. the -preview/-2 variants) and, like its predecessor,
# supports Matryoshka truncation via output_dimensionality, so it can
# still be pinned to 768 to match the `vector(768)` columns already in
# the schema (supabase/migrations/0001_initial_schema.sql) without a
# migration.
EMBEDDING_MODEL = os.environ.get("GEMINI_EMBEDDING_MODEL", "gemini-embedding-001")
EMBEDDING_DIMENSIONS = 768

# Every agent's response_format schema (review.py, workflow.py, planner,
# research.py, ...) is written as plain JSON Schema, including
# "additionalProperties": false to keep the model from inventing extra
# keys. Gemini's response_schema is only a subset of OpenAPI 3.0 Schema
# Object though, and 400s on any key outside that subset - discovered
# live, not from docs: every one of those calls has been failing this
# whole time (masked because GEMINI_API_KEY was blank until now, so
# nothing had actually round-tripped through the real API yet). Strip
# the unsupported keys recursively rather than hand-editing every
# schema, so callers keep writing normal JSON Schema.
_UNSUPPORTED_SCHEMA_KEYS = {"additionalProperties", "$schema", "title"}


def _sanitize_schema_for_gemini(node: Any) -> Any:
    if isinstance(node, dict):
        result = {}
        for key, value in node.items():
            if key == "properties" and isinstance(value, dict):
                # These keys are field names (planner.py has a real task
                # field called "title"), not schema keywords - a field
                # happening to share a name with one of
                # _UNSUPPORTED_SCHEMA_KEYS must never be stripped just
                # because of that collision (caught live: this exact
                # planner schema round-tripped as
                # "response_schema.properties[groups].items.properties
                # [tasks].items.required[0]: property is not defined"
                # once "title" got silently deleted from a sibling
                # tasks[].properties dict below it).
                result[key] = {
                    field_name: _sanitize_schema_for_gemini(field_schema)
                    for field_name, field_schema in value.items()
                }
            elif key == "type" and isinstance(value, list):
                # JSON Schema's nullable-union shorthand (pipeline.py's
                # classification schema uses "type": ["string", "null"]
                # for optional fields) isn't valid for Gemini's Schema -
                # confirmed live via a pydantic ValidationError naming
                # exactly this pattern ("Input should be 'STRING', ...
                # input_value=['string', 'null']"). Gemini's equivalent
                # is a single concrete `type` plus a separate `nullable`
                # flag, so translate rather than strip - dropping "type"
                # entirely would leave the field with no type at all.
                non_null = [t for t in value if t != "null"]
                if "null" in value:
                    result["nullable"] = True
                result[key] = non_null[0] if non_null else "null"
            elif key not in _UNSUPPORTED_SCHEMA_KEYS:
                result[key] = _sanitize_schema_for_gemini(value)
        return result
    if isinstance(node, list):
        return [_sanitize_schema_for_gemini(item) for item in node]
    return node


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
                        response_schema=_sanitize_schema_for_gemini(schema),
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

    def extract_text_from_media(self, mime_type: str, data: bytes, prompt: str) -> str:
        """Transcribe/extract text from a raw audio, image, or PDF blob
        (packages/ai_core/ai_core/pipeline.py's voice/image/pdf capture
        path). Gemini takes binary input directly per the design doc's
        open question ("current assumption is Gemini handles audio input
        directly") - no separate transcription/OCR service needed.

        Deliberately not routed through .chat.completions.create: that
        wrapper's messages are plain strings matching our OpenAI-shaped
        usage elsewhere, and bolting multimodal parts onto it would mean
        reshaping every other caller's message format for one use site.
        """
        response = self._client.models.generate_content(
            model=CHAT_MODEL,
            contents=[
                types.Part.from_bytes(data=data, mime_type=mime_type),
                prompt,
            ],
        )
        return response.text or ""


def get_client() -> GeminiClient:
    """Get a configured Gemini client instance."""
    return GeminiClient()