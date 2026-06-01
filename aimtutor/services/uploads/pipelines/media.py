"""Audio / video uploads — metadata summary for the LLM context.

Full multimodal ingestion of long media in chat is provider-specific; this
pipeline records a structured summary so the tutor can ask clarifying
questions. Vision-capable models still receive images via the image pipeline.
"""

from __future__ import annotations

from aimtutor.services.uploads.pipelines.base import PipelineContext, PipelineOutcome
from aimtutor.services.uploads.types import UploadCategory, UploadClassification


def _human_size(num_bytes: int) -> str:
    if num_bytes < 1024:
        return f"{num_bytes} B"
    if num_bytes < 1024 * 1024:
        return f"{num_bytes / 1024:.1f} KB"
    return f"{num_bytes / (1024 * 1024):.1f} MB"


class MediaPipeline:
    pipeline_id = "media"

    def process(
        self,
        *,
        filename: str,
        data: bytes,
        classification: UploadClassification,
        record: dict,
        ctx: PipelineContext,
    ) -> PipelineOutcome:
        del record, ctx
        kind = "Audio" if classification.category is UploadCategory.AUDIO else "Video"
        summary = (
            f"[{kind} attachment: {filename}]\n"
            f"MIME: {classification.canonical_mime}\n"
            f"Size: {_human_size(len(data))}\n"
            "The bytes are stored for download/preview. "
            "Describe what you need from this clip in your message and the tutor "
            "will help using your explanation."
        )
        return PipelineOutcome(
            doc_text=summary,
            record_updates={
                "type": "file",
                "base64": "",
                "extracted_chars": len(summary),
                "extracted_text": summary,
                "pipeline": self.pipeline_id,
                "upload_category": classification.category.value,
                "mime_type": classification.canonical_mime,
            },
        )
