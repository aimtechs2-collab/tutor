"""MIME-aware upload classification for chat attachments.

Classification order:
  1. Sanitise filename / extension
  2. Reject dangerous types (executables, active content)
  3. Match declared MIME against an allowlist for the extension
  4. Optional magic-byte verification when raw bytes are available
"""

from __future__ import annotations

import logging
import mimetypes
from pathlib import PurePosixPath

from aimtutor.services.rag.file_routing import FileTypeRouter
from aimtutor.services.uploads.types import UploadCategory, UploadClassification

logger = logging.getLogger(__name__)

# Extensions that must never be ingested via chat upload.
_BLOCKED_EXTENSIONS: frozenset[str] = frozenset(
    {
        ".exe",
        ".dll",
        ".msi",
        ".bat",
        ".cmd",
        ".com",
        ".scr",
        ".ps1",
        ".vbs",
        ".js",
        ".jar",
        ".apk",
        ".dmg",
        ".deb",
        ".rpm",
        ".iso",
        ".img",
    }
)

_LEGACY_OFFICE: frozenset[str] = frozenset({".doc", ".xls", ".ppt", ".rtf"})

_IMAGE_MIMES: frozenset[str] = frozenset(
    {
        "image/png",
        "image/jpeg",
        "image/jpg",
        "image/gif",
        "image/webp",
        "image/bmp",
        "image/tiff",
        "image/x-icon",
    }
)

_IMAGE_EXTENSIONS: frozenset[str] = frozenset(FileTypeRouter.IMAGE_EXTENSIONS)

# SVG is routed through text extraction, not vision.
_SVG_EXTENSIONS: frozenset[str] = frozenset({".svg"})
_SVG_MIMES: frozenset[str] = frozenset({"image/svg+xml"})

_PDF_MIMES: frozenset[str] = frozenset({"application/pdf"})
_WORD_MIMES: frozenset[str] = frozenset(
    {
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/msword",
    }
)
_EXCEL_MIMES: frozenset[str] = frozenset(
    {
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-excel",
    }
)
_PPT_MIMES: frozenset[str] = frozenset(
    {
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "application/vnd.ms-powerpoint",
    }
)

_ARCHIVE_MIMES: frozenset[str] = frozenset(
    {
        "application/zip",
        "application/x-zip-compressed",
        "application/x-zip",
    }
)
_ARCHIVE_EXTENSIONS: frozenset[str] = frozenset({".zip"})

_AUDIO_MIMES: frozenset[str] = frozenset(
    {
        "audio/mpeg",
        "audio/mp3",
        "audio/mp4",
        "audio/m4a",
        "audio/wav",
        "audio/x-wav",
        "audio/webm",
        "audio/ogg",
        "audio/flac",
        "audio/aac",
    }
)
_AUDIO_EXTENSIONS: frozenset[str] = frozenset(
    {".mp3", ".wav", ".m4a", ".ogg", ".webm", ".flac", ".aac"}
)

_VIDEO_MIMES: frozenset[str] = frozenset(
    {
        "video/mp4",
        "video/webm",
        "video/quicktime",
        "video/x-msvideo",
        "video/x-matroska",
    }
)
_VIDEO_EXTENSIONS: frozenset[str] = frozenset({".mp4", ".webm", ".mov", ".avi", ".mkv"})

_TEXT_EXTENSIONS: frozenset[str] = frozenset(FileTypeRouter.TEXT_EXTENSIONS)

_CATEGORY_PIPELINE: dict[UploadCategory, str] = {
    UploadCategory.IMAGE: "image",
    UploadCategory.PDF: "document",
    UploadCategory.WORD: "document",
    UploadCategory.EXCEL: "document",
    UploadCategory.PRESENTATION: "document",
    UploadCategory.TEXT: "document",
    UploadCategory.ARCHIVE: "archive",
    UploadCategory.AUDIO: "media",
    UploadCategory.VIDEO: "media",
    UploadCategory.UNSUPPORTED: "reject",
}

_MAGIC = {
    "pdf": b"%PDF-",
    "zip": b"PK\x03\x04",
    "png": b"\x89PNG\r\n\x1a\n",
    "jpeg": b"\xff\xd8\xff",
    "gif": b"GIF87a",
    "gif89": b"GIF89a",
    "webp": b"RIFF",
}


def _ext(filename: str) -> str:
    return PurePosixPath(filename or "file").suffix.lower()


def _normalise_mime(declared: str, filename: str) -> str:
    raw = (declared or "").split(";", 1)[0].strip().lower()
    if raw:
        return raw
    guessed, _ = mimetypes.guess_type(filename or "")
    return (guessed or "application/octet-stream").lower()


def _mime_matches(ext: str, mime: str, allowed_mimes: frozenset[str]) -> bool:
    if mime in allowed_mimes:
        return True
    if ext in _TEXT_EXTENSIONS:
        return mime.startswith("text/") or mime in {
            "application/json",
            "application/xml",
            "application/javascript",
            "application/typescript",
            "application/sql",
            "application/yaml",
            "application/x-yaml",
        }
    return False


def _category_for(ext: str, mime: str) -> UploadCategory:
    if ext in _SVG_EXTENSIONS or mime in _SVG_MIMES:
        return UploadCategory.TEXT
    if ext in _IMAGE_EXTENSIONS or mime.startswith("image/"):
        if mime in _SVG_MIMES:
            return UploadCategory.TEXT
        return UploadCategory.IMAGE
    if ext == ".pdf" or mime in _PDF_MIMES:
        return UploadCategory.PDF
    if ext == ".docx" or mime in _WORD_MIMES:
        return UploadCategory.WORD
    if ext == ".xlsx" or mime in _EXCEL_MIMES:
        return UploadCategory.EXCEL
    if ext == ".pptx" or mime in _PPT_MIMES:
        return UploadCategory.PRESENTATION
    if ext in _ARCHIVE_EXTENSIONS or mime in _ARCHIVE_MIMES:
        return UploadCategory.ARCHIVE
    if ext in _AUDIO_EXTENSIONS or mime.startswith("audio/"):
        return UploadCategory.AUDIO
    if ext in _VIDEO_EXTENSIONS or mime.startswith("video/"):
        return UploadCategory.VIDEO
    if ext in _TEXT_EXTENSIONS or _mime_matches(ext, mime, frozenset()):
        return UploadCategory.TEXT
    return UploadCategory.UNSUPPORTED


def _verify_magic(category: UploadCategory, data: bytes) -> str | None:
    """Return an error message when magic bytes contradict the category."""
    if category is UploadCategory.PDF and not data.startswith(_MAGIC["pdf"]):
        return "file content is not a valid PDF"
    if len(data) < 12:
        return None
    if category is UploadCategory.ARCHIVE and not data.startswith(_MAGIC["zip"]):
        return "file content is not a valid ZIP archive"
    if category is UploadCategory.IMAGE:
        if data.startswith(_MAGIC["png"]):
            return None
        if data.startswith(_MAGIC["jpeg"]):
            return None
        if data.startswith(_MAGIC["gif"]) or data.startswith(_MAGIC["gif89"]):
            return None
        if data.startswith(_MAGIC["webp"]) and data[8:12] == b"WEBP":
            return None
        # BMP / TIFF and other rarer image types skip strict magic
        if data[:4] == b"BM  " or data[:2] in {b"II", b"MM"}:
            return None
        return "file content does not look like a supported image"
    if category in {UploadCategory.WORD, UploadCategory.EXCEL, UploadCategory.PRESENTATION}:
        if not data.startswith(_MAGIC["zip"]):
            return "file content is not a valid Office document"
    return None


def classify_upload(
    filename: str,
    declared_mime: str = "",
    data: bytes | None = None,
) -> UploadClassification:
    """Classify an upload for pipeline routing."""
    safe_name = PurePosixPath((filename or "file").replace("\\", "/")).name
    ext = _ext(safe_name)
    mime = _normalise_mime(declared_mime, safe_name)

    if not safe_name or safe_name in {".", ".."}:
        return UploadClassification(
            category=UploadCategory.UNSUPPORTED,
            attachment_type="file",
            canonical_mime=mime,
            pipeline="reject",
            extension=ext,
            reason="invalid filename",
        )

    if ext in _BLOCKED_EXTENSIONS:
        return UploadClassification(
            category=UploadCategory.UNSUPPORTED,
            attachment_type="file",
            canonical_mime=mime,
            pipeline="reject",
            extension=ext,
            reason=f"file type {ext} is not allowed",
        )

    if ext in _LEGACY_OFFICE:
        return UploadClassification(
            category=UploadCategory.UNSUPPORTED,
            attachment_type="file",
            canonical_mime=mime,
            pipeline="reject",
            extension=ext,
            reason=f"legacy {ext} is not supported — please upload the modern Office format",
        )

    category = _category_for(ext, mime)

    if category is UploadCategory.UNSUPPORTED:
        return UploadClassification(
            category=category,
            attachment_type="file",
            canonical_mime=mime,
            pipeline="reject",
            extension=ext,
            reason=f"unsupported type ({ext or mime})",
        )

    if data:
        magic_err = _verify_magic(category, data)
        if magic_err:
            logger.info("upload magic mismatch for %s: %s", safe_name, magic_err)
            return UploadClassification(
                category=UploadCategory.UNSUPPORTED,
                attachment_type="file",
                canonical_mime=mime,
                pipeline="reject",
                extension=ext,
                reason=magic_err,
            )

    attachment_type = "image" if category is UploadCategory.IMAGE else "file"
    return UploadClassification(
        category=category,
        attachment_type=attachment_type,
        canonical_mime=mime,
        pipeline=_CATEGORY_PIPELINE[category],
        extension=ext,
    )


def supported_accept_list() -> dict[str, list[str]]:
    """MIME types and extensions exposed to the frontend picker."""
    return {
        "image": sorted(_IMAGE_MIMES),
        "document": sorted(
            _PDF_MIMES
            | _WORD_MIMES
            | _EXCEL_MIMES
            | _PPT_MIMES
            | {
                "text/plain",
                "text/markdown",
                "application/json",
            }
        ),
        "text_extensions": sorted(_TEXT_EXTENSIONS),
        "archive": sorted(_ARCHIVE_MIMES),
        "audio": sorted(_AUDIO_MIMES),
        "video": sorted(_VIDEO_MIMES),
        "extensions": sorted(
            _IMAGE_EXTENSIONS
            | {".pdf", ".docx", ".xlsx", ".pptx"}
            | _TEXT_EXTENSIONS
            | _ARCHIVE_EXTENSIONS
            | _AUDIO_EXTENSIONS
            | _VIDEO_EXTENSIONS
            | _SVG_EXTENSIONS
        ),
    }
