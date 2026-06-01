"""Image uploads — preserved for vision models (no text extraction)."""

from __future__ import annotations

from aimtutor.services.uploads.pipelines.base import PipelineContext, PipelineOutcome
from aimtutor.services.uploads.types import UploadClassification


class ImagePipeline:
    pipeline_id = "image"

    def process(
        self,
        *,
        filename: str,
        data: bytes,
        classification: UploadClassification,
        record: dict,
        ctx: PipelineContext,
    ) -> PipelineOutcome:
        del data, ctx
        return PipelineOutcome(
            record_updates={
                "type": "image",
                "mime_type": classification.canonical_mime,
                "pipeline": self.pipeline_id,
                "upload_category": classification.category.value,
            },
        )
