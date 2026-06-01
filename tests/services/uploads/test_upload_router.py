"""Tests for MIME-routed attachment processing."""

from __future__ import annotations

import base64
import io
import zipfile

from aimtutor.services.uploads.router import process_attachment_records


def _record(name: str, data: bytes, mime: str = "") -> dict:
    return {
        "type": "file",
        "filename": name,
        "mime_type": mime,
        "base64": base64.b64encode(data).decode("ascii"),
        "url": "",
        "id": "att1",
    }


def test_image_keeps_base64() -> None:
    png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 40
    records = [_record("x.png", png, "image/png")]
    texts, updated = process_attachment_records(records)
    assert texts == []
    assert updated[0]["type"] == "image"
    assert updated[0]["base64"]
    assert updated[0]["pipeline"] == "image"


def test_zip_produces_extracted_text() -> None:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("hello.txt", "world from zip")
    texts, updated = process_attachment_records(
        [_record("data.zip", buf.getvalue(), "application/zip")]
    )
    assert len(texts) == 1
    assert "world from zip" in texts[0]
    assert updated[0]["extracted_text"]
    assert updated[0]["base64"] == ""


def test_audio_summary() -> None:
    texts, updated = process_attachment_records(
        [_record("song.mp3", b"ID3" + b"\x00" * 20, "audio/mpeg")]
    )
    assert len(texts) == 1
    assert "Audio attachment" in texts[0]
    assert updated[0]["upload_category"] == "audio"
