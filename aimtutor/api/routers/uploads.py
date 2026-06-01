"""Upload policy and MIME classification API."""

from __future__ import annotations

import base64

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from aimtutor.api.routers.auth import require_auth
from aimtutor.services.uploads.mime_registry import classify_upload, supported_accept_list
from aimtutor.services.uploads.types import MAX_FILE_BYTES, MAX_TOTAL_BYTES

router = APIRouter()


class ClassifyUploadRequest(BaseModel):
    filename: str = Field(..., min_length=1, max_length=512)
    mime_type: str = ""
    size_bytes: int | None = Field(default=None, ge=0, le=MAX_FILE_BYTES)
    base64: str | None = Field(
        default=None,
        description="Optional payload prefix for magic-byte verification (first 64 KB only).",
    )


class ExtractUploadRequest(BaseModel):
    filename: str = Field(..., min_length=1, max_length=512)
    mime_type: str = ""
    base64: str = Field(..., description="Full file payload, base64-encoded.")


@router.get("/policy")
async def get_upload_policy(_payload=Depends(require_auth)) -> dict:
    """Return allowed MIME types / extensions for the chat composer."""
    del _payload
    accept = supported_accept_list()
    return {
        "max_file_bytes": MAX_FILE_BYTES,
        "max_total_bytes": MAX_TOTAL_BYTES,
        "accept": accept,
        "accept_attribute": ",".join(
            [
                "image/*",
                *accept["extensions"],
                *accept["document"],
                *accept["archive"],
                *accept["audio"],
                *accept["video"],
            ]
        ),
    }


@router.post("/classify")
async def classify_upload_endpoint(
    body: ClassifyUploadRequest,
    _payload=Depends(require_auth),
) -> dict:
    """Classify a would-be upload (used by the frontend before attaching)."""
    del _payload
    sample: bytes | None = None
    if body.base64:
        try:
            raw = base64.b64decode(body.base64, validate=False)
            sample = raw[:65536]
        except Exception as exc:
            raise HTTPException(400, f"Invalid base64 sample: {exc}") from exc

    if body.size_bytes is not None and body.size_bytes > MAX_FILE_BYTES:
        raise HTTPException(413, f"File exceeds {MAX_FILE_BYTES // (1024 * 1024)} MB limit")

    result = classify_upload(body.filename, body.mime_type, sample)
    return {
        "supported": result.supported,
        "category": result.category.value,
        "pipeline": result.pipeline,
        "attachment_type": result.attachment_type,
        "canonical_mime": result.canonical_mime,
        "reason": result.reason,
    }


@router.post("/extract")
async def extract_upload_endpoint(
    body: ExtractUploadRequest,
    _payload=Depends(require_auth),
) -> dict:
    """Extract text from a single uploaded file via the MIME upload pipeline.

    Used by Live voice mode, where files dropped mid-session must be turned
    into text the model can read (images are sent directly as video frames by
    the client and do not need this endpoint).
    """
    del _payload
    from aimtutor.services.uploads.router import process_attachment_records

    record = {
        "filename": body.filename,
        "mime_type": body.mime_type,
        "base64": body.base64,
        "type": "file",
    }
    try:
        doc_texts, updated = process_attachment_records([record])
    except Exception as exc:  # pragma: no cover - defensive
        raise HTTPException(500, f"Extraction failed: {exc}") from exc

    updated_record = updated[0] if updated else {}
    category = str(updated_record.get("upload_category") or "")
    extracted_text = str(updated_record.get("extracted_text") or "")
    text = extracted_text or "\n\n".join(doc_texts)

    return {
        "filename": body.filename,
        "category": category,
        "pipeline": str(updated_record.get("pipeline") or ""),
        "mime_type": str(updated_record.get("mime_type") or body.mime_type),
        "supported": bool(extracted_text) or category == "image",
        "text": text,
        "chars": len(text),
    }
