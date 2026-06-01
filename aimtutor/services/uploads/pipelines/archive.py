"""ZIP archive pipeline — safe listing + text extraction from members."""

from __future__ import annotations

import io
import logging
import zipfile
from pathlib import PurePosixPath

from aimtutor.services.rag.file_routing import FileTypeRouter
from aimtutor.services.uploads.pipelines.base import PipelineContext, PipelineOutcome
from aimtutor.services.uploads.types import (
    MAX_EXTRACTED_CHARS_PER_FILE,
    MAX_EXTRACTED_CHARS_TOTAL,
    UploadClassification,
)
from aimtutor.utils.document_extractor import (
    DocumentExtractionError,
    extract_text_from_bytes,
    is_document_extension,
)

logger = logging.getLogger(__name__)

_MAX_ARCHIVE_MEMBERS = 40
_MAX_MEMBER_BYTES = 2 * 1024 * 1024
_MAX_ARCHIVE_OUTPUT_CHARS = 80_000

_TEXT_MEMBER_EXTENSIONS: frozenset[str] = frozenset(FileTypeRouter.TEXT_EXTENSIONS) | frozenset(
    {".pdf", ".docx", ".xlsx", ".pptx", ".csv", ".md", ".txt"}
)


def _safe_member_name(name: str) -> bool:
    normalised = name.replace("\\", "/")
    if normalised.startswith("/") or ".." in normalised.split("/"):
        return False
    return True


class ArchivePipeline:
    pipeline_id = "archive"

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
            return self._skip(filename, classification, "total extracted-text quota exceeded")

        try:
            zf = zipfile.ZipFile(io.BytesIO(data))
        except zipfile.BadZipFile as exc:
            return self._error(filename, classification, f"invalid ZIP ({exc})")

        members = [info for info in zf.infolist() if not info.is_dir()]
        if len(members) > _MAX_ARCHIVE_MEMBERS:
            members = members[:_MAX_ARCHIVE_MEMBERS]
            truncated_list = True
        else:
            truncated_list = False

        lines: list[str] = [f"[Archive: {filename}]"]
        extracted_parts: list[str] = []
        output_chars = 0

        for info in members:
            if not _safe_member_name(info.filename):
                logger.warning("skipping unsafe zip path: %s", info.filename)
                continue
            member_name = PurePosixPath(info.filename).name
            ext = PurePosixPath(member_name).suffix.lower()
            lines.append(f"- {info.filename} ({info.file_size} bytes)")

            if output_chars >= _MAX_ARCHIVE_OUTPUT_CHARS:
                continue
            if info.file_size > _MAX_MEMBER_BYTES:
                extracted_parts.append(
                    f"[{member_name} — skipped: member exceeds {_MAX_MEMBER_BYTES // (1024 * 1024)} MB]"
                )
                continue
            if ext not in _TEXT_MEMBER_EXTENSIONS and not is_document_extension(member_name):
                continue

            try:
                payload = zf.read(info)
            except (RuntimeError, zipfile.BadZipFile) as exc:
                extracted_parts.append(f"[{member_name} — could not read: {exc}]")
                continue

            try:
                text = extract_text_from_bytes(
                    member_name,
                    payload,
                    max_chars=min(MAX_EXTRACTED_CHARS_PER_FILE, 40_000),
                )
            except DocumentExtractionError as exc:
                extracted_parts.append(f"[{member_name} — could not extract: {exc}]")
                continue

            chunk = f"--- {member_name} ---\n{text}"
            if output_chars + len(chunk) > _MAX_ARCHIVE_OUTPUT_CHARS:
                chunk = chunk[: _MAX_ARCHIVE_OUTPUT_CHARS - output_chars] + "\n...(truncated)"
            extracted_parts.append(chunk)
            output_chars += len(chunk)

        if truncated_list:
            lines.append(f"(listing truncated to {_MAX_ARCHIVE_MEMBERS} files)")

        body = "\n".join(lines)
        if extracted_parts:
            body += "\n\n[Extracted archive contents]\n" + "\n\n".join(extracted_parts)

        if ctx.total_chars + len(body) > MAX_EXTRACTED_CHARS_TOTAL:
            body = body[: max(0, MAX_EXTRACTED_CHARS_TOTAL - ctx.total_chars)] + "\n...(truncated)"
            ctx.over_char_quota = True

        ctx.total_chars += len(body)
        return PipelineOutcome(
            doc_text=body,
            record_updates={
                "type": "file",
                "base64": "",
                "extracted_chars": len(body),
                "extracted_text": body,
                "pipeline": self.pipeline_id,
                "upload_category": classification.category.value,
                "mime_type": classification.canonical_mime,
            },
        )

    def _skip(
        self, filename: str, classification: UploadClassification, reason: str
    ) -> PipelineOutcome:
        return PipelineOutcome(
            doc_text=f"[File: {filename} — skipped: {reason}]",
            record_updates=self._base_updates(classification, chars=0),
        )

    def _error(
        self, filename: str, classification: UploadClassification, reason: str
    ) -> PipelineOutcome:
        return PipelineOutcome(
            doc_text=f"[File: {filename} — could not be read: {reason}]",
            record_updates=self._base_updates(classification, chars=0),
        )

    @staticmethod
    def _base_updates(classification: UploadClassification, *, chars: int) -> dict:
        return {
            "type": "file",
            "base64": "",
            "extracted_chars": chars,
            "pipeline": "archive",
            "upload_category": classification.category.value,
            "mime_type": classification.canonical_mime,
        }
