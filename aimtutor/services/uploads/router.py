"""Route chat attachment uploads through MIME-aware pipelines."""

from __future__ import annotations

import base64
import logging
from collections.abc import Iterable

from aimtutor.services.uploads.mime_registry import classify_upload
from aimtutor.services.uploads.pipelines import (
    ArchivePipeline,
    DocumentPipeline,
    ImagePipeline,
    MediaPipeline,
)
from aimtutor.services.uploads.pipelines.base import PipelineContext
from aimtutor.services.uploads.types import (
    MAX_FILE_BYTES,
    MAX_TOTAL_BYTES,
    UploadCategory,
)

logger = logging.getLogger(__name__)

_PIPELINES = {
    "image": ImagePipeline(),
    "document": DocumentPipeline(),
    "archive": ArchivePipeline(),
    "media": MediaPipeline(),
}


def process_attachment_records(
    records: Iterable[dict],
) -> tuple[list[str], list[dict]]:
    """Process WS attachment records with MIME routing.

    Compatible drop-in for ``extract_documents_from_records`` — returns
    ``(doc_texts, updated_records)`` for the turn runtime.
    """
    doc_texts: list[str] = []
    updated: list[dict] = []
    ctx = PipelineContext()

    for raw in records:
        record = dict(raw)
        filename = str(record.get("filename") or "file")
        declared_mime = str(record.get("mime_type") or "")
        b64 = record.get("base64") or ""

        if not b64:
            updated.append(record)
            continue

        if ctx.over_byte_quota:
            doc_texts.append(f"[File: {filename} — skipped: total attachment quota exceeded]")
            record["base64"] = ""
            record["extracted_chars"] = 0
            updated.append(record)
            continue

        try:
            data = base64.b64decode(b64, validate=False)
        except Exception as exc:
            doc_texts.append(f"[File: {filename} — could not be read: invalid base64 ({exc})]")
            record["base64"] = ""
            record["extracted_chars"] = 0
            updated.append(record)
            continue

        if len(data) > MAX_FILE_BYTES:
            doc_texts.append(
                f"[File: {filename} — skipped: exceeds {MAX_FILE_BYTES // (1024 * 1024)} MB per file]"
            )
            record["base64"] = ""
            record["extracted_chars"] = 0
            updated.append(record)
            continue

        if ctx.total_bytes + len(data) > MAX_TOTAL_BYTES:
            ctx.over_byte_quota = True
            doc_texts.append(f"[File: {filename} — skipped: total attachment quota exceeded]")
            record["base64"] = ""
            record["extracted_chars"] = 0
            updated.append(record)
            continue

        ctx.total_bytes += len(data)

        classification = classify_upload(filename, declared_mime, data)
        record["mime_type"] = classification.canonical_mime
        record["upload_category"] = classification.category.value
        record["pipeline"] = classification.pipeline

        if not classification.supported:
            reason = classification.reason or "unsupported file type"
            doc_texts.append(f"[File: {filename} — rejected: {reason}]")
            record["base64"] = ""
            record["extracted_chars"] = 0
            record["type"] = "file"
            updated.append(record)
            continue

        pipeline = _PIPELINES.get(classification.pipeline)
        if pipeline is None:
            doc_texts.append(f"[File: {filename} — rejected: no pipeline configured]")
            record["base64"] = ""
            record["extracted_chars"] = 0
            updated.append(record)
            continue

        outcome = pipeline.process(
            filename=filename,
            data=data,
            classification=classification,
            record=record,
            ctx=ctx,
        )
        record.update(outcome.record_updates)

        # Images keep base64 for vision until persisted; document pipelines clear it.
        if classification.category is not UploadCategory.IMAGE:
            record.setdefault("base64", "")

        if outcome.doc_text:
            doc_texts.append(outcome.doc_text)

        updated.append(record)

    return doc_texts, updated
