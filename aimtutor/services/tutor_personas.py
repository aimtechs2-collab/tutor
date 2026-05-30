"""Tutor persona and prompt version persistence."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from psycopg2.extras import Json

from aimtutor.services.courses import slugify
from aimtutor.services.db import connect

DEFAULT_BEHAVIOR = {
    "temperature": 0.7,
    "max_tokens": 2048,
    "tone": "friendly",
    "verbosity": "balanced",
    "safety_level": "standard",
}


def _iso_timestamp(value: Any) -> str:
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).isoformat()
    return str(value or "")


def _parse_json(value: Any, default: Any) -> Any:
    if value is None:
        return default
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return default
    return default


def _persona_row(row: dict[str, Any], **extra: Any) -> dict[str, Any]:
    payload = {
        "id": str(row["id"]),
        "name": str(row["name"]),
        "slug": str(row["slug"]),
        "description": str(row.get("description") or ""),
        "avatar_url": str(row.get("avatar_url") or ""),
        "expertise_tags": _parse_json(row.get("expertise_tags"), []),
        "voice_model": str(row.get("voice_model") or ""),
        "voice_badge": str(row.get("voice_badge") or ""),
        "is_published": bool(row.get("is_published", False)),
        "behavior_settings": _parse_json(row.get("behavior_settings"), {}),
        "current_prompt_version_id": row.get("current_prompt_version_id"),
        "created_by": str(row.get("created_by") or ""),
        "created_at": _iso_timestamp(row.get("created_at")),
        "updated_at": _iso_timestamp(row.get("updated_at")),
    }
    payload.update(extra)
    return payload


def _version_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(row["id"]),
        "persona_id": str(row["persona_id"]),
        "version_number": int(row["version_number"]),
        "system_prompt": str(row.get("system_prompt") or ""),
        "change_note": str(row.get("change_note") or ""),
        "created_by": str(row.get("created_by") or ""),
        "created_at": _iso_timestamp(row.get("created_at")),
    }


def list_personas_sync() -> list[dict[str, Any]]:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT *
            FROM tutor_personas
            ORDER BY updated_at DESC, name ASC
            """
        )
        rows = cur.fetchall()
    return [_persona_row(dict(row)) for row in rows]


def get_persona_sync(persona_id: str) -> dict[str, Any] | None:
    with connect() as conn, conn.cursor() as cur:
        cur.execute("SELECT * FROM tutor_personas WHERE id = %s", (persona_id,))
        row = cur.fetchone()
        if row is None:
            return None
        persona = _persona_row(dict(row))
        cur.execute(
            """
            SELECT *
            FROM tutor_prompt_versions
            WHERE persona_id = %s
            ORDER BY version_number DESC
            """,
            (persona_id,),
        )
        versions = [_version_row(dict(v)) for v in cur.fetchall()]
        current = next(
            (v for v in versions if v["id"] == persona.get("current_prompt_version_id")),
            versions[0] if versions else None,
        )
        persona["prompt_versions"] = versions
        persona["current_prompt"] = current
    return persona


def create_persona_sync(
    *,
    name: str,
    slug: str | None,
    description: str,
    avatar_url: str,
    expertise_tags: list[str],
    voice_model: str,
    voice_badge: str,
    behavior_settings: dict[str, Any],
    system_prompt: str,
    created_by: str,
) -> dict[str, Any]:
    persona_id = f"persona_{uuid4().hex}"
    version_id = f"tvpv_{uuid4().hex}"
    resolved_slug = slugify(slug or name)
    merged_behavior = {**DEFAULT_BEHAVIOR, **(behavior_settings or {})}
    prompt = (system_prompt or "").strip() or f"You are {name}, an expert AI tutor."

    with connect() as conn, conn.cursor() as cur:
        cur.execute("SELECT id FROM tutor_personas WHERE slug = %s", (resolved_slug,))
        if cur.fetchone():
            resolved_slug = f"{resolved_slug}-{uuid4().hex[:6]}"
        cur.execute(
            """
            INSERT INTO tutor_personas (
                id, name, slug, description, avatar_url, expertise_tags,
                voice_model, voice_badge, is_published, behavior_settings,
                current_prompt_version_id, created_by, created_at, updated_at
            ) VALUES (
                %s, %s, %s, %s, %s, %s, %s, %s, false, %s, %s, %s, now(), now()
            )
            """,
            (
                persona_id,
                name.strip(),
                resolved_slug,
                description.strip(),
                avatar_url.strip(),
                Json(expertise_tags or []),
                voice_model.strip(),
                voice_badge.strip(),
                Json(merged_behavior),
                version_id,
                created_by,
            ),
        )
        cur.execute(
            """
            INSERT INTO tutor_prompt_versions (
                id, persona_id, version_number, system_prompt, change_note, created_by, created_at
            ) VALUES (%s, %s, 1, %s, %s, %s, now())
            """,
            (version_id, persona_id, prompt, "Initial version", created_by),
        )
        conn.commit()
    result = get_persona_sync(persona_id)
    assert result is not None
    return result


def update_persona_sync(
    persona_id: str,
    *,
    name: str | None = None,
    slug: str | None = None,
    description: str | None = None,
    avatar_url: str | None = None,
    expertise_tags: list[str] | None = None,
    voice_model: str | None = None,
    voice_badge: str | None = None,
    behavior_settings: dict[str, Any] | None = None,
) -> dict[str, Any]:
    existing = get_persona_sync(persona_id)
    if existing is None:
        raise ValueError("Persona not found")

    fields: list[str] = []
    values: list[Any] = []
    if name is not None:
        fields.append("name = %s")
        values.append(name.strip())
    if slug is not None:
        resolved = slugify(slug)
        fields.append("slug = %s")
        values.append(resolved)
    if description is not None:
        fields.append("description = %s")
        values.append(description.strip())
    if avatar_url is not None:
        fields.append("avatar_url = %s")
        values.append(avatar_url.strip())
    if expertise_tags is not None:
        fields.append("expertise_tags = %s")
        values.append(Json(expertise_tags))
    if voice_model is not None:
        fields.append("voice_model = %s")
        values.append(voice_model.strip())
    if voice_badge is not None:
        fields.append("voice_badge = %s")
        values.append(voice_badge.strip())
    if behavior_settings is not None:
        merged = {**DEFAULT_BEHAVIOR, **existing.get("behavior_settings", {}), **behavior_settings}
        fields.append("behavior_settings = %s")
        values.append(Json(merged))

    if not fields:
        return existing

    fields.append("updated_at = now()")
    values.append(persona_id)
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            f"UPDATE tutor_personas SET {', '.join(fields)} WHERE id = %s",
            tuple(values),
        )
        conn.commit()
    result = get_persona_sync(persona_id)
    assert result is not None
    return result


def delete_persona_sync(persona_id: str) -> bool:
    with connect() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM tutor_personas WHERE id = %s RETURNING id", (persona_id,))
        deleted = cur.fetchone()
        conn.commit()
    return deleted is not None


def toggle_publish_sync(persona_id: str) -> dict[str, Any]:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE tutor_personas
            SET is_published = NOT is_published, updated_at = now()
            WHERE id = %s
            RETURNING *
            """,
            (persona_id,),
        )
        row = cur.fetchone()
        conn.commit()
    if row is None:
        raise ValueError("Persona not found")
    return _persona_row(dict(row))


def create_prompt_version_sync(
    persona_id: str,
    *,
    system_prompt: str,
    change_note: str,
    created_by: str,
) -> dict[str, Any]:
    prompt = (system_prompt or "").strip()
    if not prompt:
        raise ValueError("System prompt is required")

    version_id = f"tvpv_{uuid4().hex}"
    with connect() as conn, conn.cursor() as cur:
        cur.execute("SELECT id FROM tutor_personas WHERE id = %s", (persona_id,))
        if cur.fetchone() is None:
            raise ValueError("Persona not found")
        cur.execute(
            """
            SELECT COALESCE(MAX(version_number), 0) AS max_version
            FROM tutor_prompt_versions
            WHERE persona_id = %s
            """,
            (persona_id,),
        )
        next_version = int(cur.fetchone()["max_version"]) + 1
        cur.execute(
            """
            INSERT INTO tutor_prompt_versions (
                id, persona_id, version_number, system_prompt, change_note, created_by, created_at
            ) VALUES (%s, %s, %s, %s, %s, %s, now())
            """,
            (version_id, persona_id, next_version, prompt, change_note.strip(), created_by),
        )
        cur.execute(
            """
            UPDATE tutor_personas
            SET current_prompt_version_id = %s, updated_at = now()
            WHERE id = %s
            """,
            (version_id, persona_id),
        )
        conn.commit()
    result = get_persona_sync(persona_id)
    assert result is not None
    return result


def rollback_prompt_sync(persona_id: str, version_id: str) -> dict[str, Any]:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT id FROM tutor_prompt_versions
            WHERE id = %s AND persona_id = %s
            """,
            (version_id, persona_id),
        )
        if cur.fetchone() is None:
            raise ValueError("Prompt version not found")
        cur.execute(
            """
            UPDATE tutor_personas
            SET current_prompt_version_id = %s, updated_at = now()
            WHERE id = %s
            """,
            (version_id, persona_id),
        )
        conn.commit()
    result = get_persona_sync(persona_id)
    assert result is not None
    return result


def get_active_system_prompt_sync(persona_id: str) -> str:
    persona = get_persona_sync(persona_id)
    if persona is None:
        raise ValueError("Persona not found")
    current = persona.get("current_prompt")
    if current and current.get("system_prompt"):
        return str(current["system_prompt"])
    return f"You are {persona['name']}, an expert AI tutor."
