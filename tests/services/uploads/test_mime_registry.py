"""Tests for upload MIME classification."""

from __future__ import annotations

import io
import zipfile

import pytest

from aimtutor.services.uploads.mime_registry import classify_upload
from aimtutor.services.uploads.types import UploadCategory


def test_classify_png_image() -> None:
    data = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
    result = classify_upload("photo.png", "image/png", data)
    assert result.category is UploadCategory.IMAGE
    assert result.pipeline == "image"
    assert result.attachment_type == "image"


def test_classify_pdf() -> None:
    data = b"%PDF-1.4\n" + b"x" * 64
    result = classify_upload("notes.pdf", "application/pdf", data)
    assert result.category is UploadCategory.PDF
    assert result.pipeline == "document"


def test_classify_zip() -> None:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("readme.txt", "hello")
    result = classify_upload("bundle.zip", "application/zip", buf.getvalue())
    assert result.category is UploadCategory.ARCHIVE
    assert result.pipeline == "archive"


def test_classify_mp3() -> None:
    result = classify_upload("clip.mp3", "audio/mpeg", b"ID3" + b"\x00" * 32)
    assert result.category is UploadCategory.AUDIO
    assert result.pipeline == "media"


def test_reject_exe() -> None:
    result = classify_upload("malware.exe", "application/octet-stream", b"MZ" + b"\x00" * 32)
    assert not result.supported
    assert result.category is UploadCategory.UNSUPPORTED


def test_reject_pdf_magic_mismatch() -> None:
    result = classify_upload("fake.pdf", "application/pdf", b"not a pdf")
    assert not result.supported
    assert "pdf" in result.reason.lower()


def test_svg_routes_to_text() -> None:
    result = classify_upload("icon.svg", "image/svg+xml", b"<svg></svg>")
    assert result.category is UploadCategory.TEXT
    assert result.pipeline == "document"
