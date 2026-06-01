"""Office + plain-text document extraction pipeline."""

from __future__ import annotations

from aimtutor.services.uploads.pipelines.base import PipelineContext, PipelineOutcome
from aimtutor.services.uploads.types import (
    MAX_EXTRACTED_CHARS_PER_FILE,
    MAX_EXTRACTED_CHARS_TOTAL,
    UploadClassification,
)
from aimtutor.utils.document_extractor import (
    DocumentExtractionError,
    extract_text_from_bytes,
)


class DocumentPipeline:
    pipeline_id = "document"

    def process(
        self,
        *,
        filename: str,
        data: bytes,
        classification: UploadClassification,
        record: dict,
        ctx: PipelineContext,
    ) -> PipelineOutcome:
        del record
        if ctx.over_char_quota:
            return PipelineOutcome(
                doc_text=f"[File: {filename} — skipped: total extracted-text quota exceeded]",
                record_updates={
                    "type": "file",
                    "base64": "",
                    "extracted_chars": 0,
                    "pipeline": self.pipeline_id,
                    "upload_category": classification.category.value,
                    "mime_type": classification.canonical_mime,
                },
            )

        try:
            text = extract_text_from_bytes(filename, data, max_chars=None)
        except DocumentExtractionError as exc:
            return PipelineOutcome(
                doc_text=f"[File: {filename} — could not be read: {exc}]",
                record_updates={
                    "type": "file",
                    "base64": "",
                    "extracted_chars": 0,
                    "pipeline": self.pipeline_id,
                    "upload_category": classification.category.value,
                    "mime_type": classification.canonical_mime,
                },
            )

        remaining_budget = MAX_EXTRACTED_CHARS_TOTAL - ctx.total_chars
        remaining = min(MAX_EXTRACTED_CHARS_PER_FILE, remaining_budget)

        if remaining <= 0:
            ctx.over_char_quota = True
            return PipelineOutcome(
                doc_text=f"[File: {filename} — skipped: total extracted-text quota exceeded]",
                record_updates={
                    "type": "file",
                    "base64": "",
                    "extracted_chars": 0,
                    "pipeline": self.pipeline_id,
                    "upload_category": classification.category.value,
                    "mime_type": classification.canonical_mime,
                },
            )

        if len(text) > remaining:
            text = (
                text[:remaining]
                + f"... (truncated, {len(text)} chars total; turn quota hit)"
            )

        ctx.total_chars += len(text)
        return PipelineOutcome(
            doc_text=f"[File: {filename}]\n{text}",
            record_updates={
                "type": "file",
                "base64": "",
                "extracted_chars": len(text),
                "extracted_text": text,
                "pipeline": self.pipeline_id,
                "upload_category": classification.category.value,
                "mime_type": classification.canonical_mime,
            },
        )
