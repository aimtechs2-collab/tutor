"""Shared types for chat upload routing."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum


class UploadCategory(str, Enum):
    """High-level bucket used to select a processing pipeline."""

    IMAGE = "image"
    PDF = "pdf"
    WORD = "word"
    EXCEL = "excel"
    PRESENTATION = "presentation"
    TEXT = "text"
    ARCHIVE = "archive"
    AUDIO = "audio"
    VIDEO = "video"
    UNSUPPORTED = "unsupported"


# Chat attachment limits (aligned with document_extractor defaults).
MAX_FILE_BYTES = 10 * 1024 * 1024
MAX_TOTAL_BYTES = 25 * 1024 * 1024
MAX_EXTRACTED_CHARS_PER_FILE = 200_000
MAX_EXTRACTED_CHARS_TOTAL = 150_000


@dataclass(frozen=True)
class UploadClassification:
    """Result of MIME + extension + magic-byte classification."""

    category: UploadCategory
    attachment_type: str  # "image" | "file"
    canonical_mime: str
    pipeline: str
    extension: str
    reason: str = ""

    @property
    def supported(self) -> bool:
        return self.category is not UploadCategory.UNSUPPORTED


@dataclass
class PipelineResult:
    """Output from a single attachment pipeline."""

    doc_text: str | None = None
    record_updates: dict = field(default_factory=dict)
