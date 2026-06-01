"""Base types for upload pipelines."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol

from aimtutor.services.uploads.types import UploadClassification


@dataclass
class PipelineContext:
    """Shared quotas while processing a batch of attachments."""

    total_bytes: int = 0
    total_chars: int = 0
    over_byte_quota: bool = False
    over_char_quota: bool = False


@dataclass
class PipelineOutcome:
    doc_text: str | None = None
    record_updates: dict = field(default_factory=dict)


class UploadPipeline(Protocol):
    pipeline_id: str

    def process(
        self,
        *,
        filename: str,
        data: bytes,
        classification: UploadClassification,
        record: dict,
        ctx: PipelineContext,
    ) -> PipelineOutcome: ...
