"""Admin CRUD for tutor personas, prompt versioning, and live testing."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from aimtutor.api.routers.auth import require_admin
from aimtutor.multi_user.audit import log_admin_action
from aimtutor.multi_user.context import get_current_user
from aimtutor.services.tutor_personas import (
    create_persona_sync,
    create_prompt_version_sync,
    delete_persona_sync,
    get_active_system_prompt_sync,
    get_persona_sync,
    list_personas_sync,
    rollback_prompt_sync,
    toggle_publish_sync,
    update_persona_sync,
)

logger = logging.getLogger(__name__)

router = APIRouter()


class PersonaCreateRequest(BaseModel):
    name: str
    slug: str | None = None
    description: str = ""
    avatar_url: str = ""
    expertise_tags: list[str] = Field(default_factory=list)
    voice_model: str = ""
    voice_badge: str = ""
    behavior_settings: dict[str, Any] = Field(default_factory=dict)
    system_prompt: str = ""


class PersonaUpdateRequest(BaseModel):
    name: str | None = None
    slug: str | None = None
    description: str | None = None
    avatar_url: str | None = None
    expertise_tags: list[str] | None = None
    voice_model: str | None = None
    voice_badge: str | None = None
    behavior_settings: dict[str, Any] | None = None


class PromptVersionRequest(BaseModel):
    system_prompt: str
    change_note: str = ""


class LiveTestRequest(BaseModel):
    message: str


@router.get("")
async def list_personas(_: Any = Depends(require_admin)) -> dict[str, Any]:
    personas = await asyncio.to_thread(list_personas_sync)
    return {"personas": personas}


@router.post("")
async def create_persona(
    body: PersonaCreateRequest,
    _: Any = Depends(require_admin),
) -> dict[str, Any]:
    actor = get_current_user()
    if not body.name.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Name is required")
    persona = await asyncio.to_thread(
        create_persona_sync,
        name=body.name,
        slug=body.slug,
        description=body.description,
        avatar_url=body.avatar_url,
        expertise_tags=body.expertise_tags,
        voice_model=body.voice_model,
        voice_badge=body.voice_badge,
        behavior_settings=body.behavior_settings,
        system_prompt=body.system_prompt,
        created_by=actor.id,
    )
    log_admin_action(
        "tutor_persona.create",
        summary={"persona_id": persona["id"], "name": persona["name"]},
    )
    return {"persona": persona}


@router.get("/{persona_id}")
async def get_persona(persona_id: str, _: Any = Depends(require_admin)) -> dict[str, Any]:
    persona = await asyncio.to_thread(get_persona_sync, persona_id)
    if persona is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Persona not found")
    return {"persona": persona}


@router.put("/{persona_id}")
async def update_persona(
    persona_id: str,
    body: PersonaUpdateRequest,
    _: Any = Depends(require_admin),
) -> dict[str, Any]:
    try:
        persona = await asyncio.to_thread(
            update_persona_sync,
            persona_id,
            name=body.name,
            slug=body.slug,
            description=body.description,
            avatar_url=body.avatar_url,
            expertise_tags=body.expertise_tags,
            voice_model=body.voice_model,
            voice_badge=body.voice_badge,
            behavior_settings=body.behavior_settings,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    log_admin_action("tutor_persona.update", summary={"persona_id": persona_id})
    return {"persona": persona}


@router.delete("/{persona_id}")
async def delete_persona(
    persona_id: str,
    _: Any = Depends(require_admin),
) -> dict[str, Any]:
    deleted = await asyncio.to_thread(delete_persona_sync, persona_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Persona not found")
    log_admin_action("tutor_persona.delete", summary={"persona_id": persona_id})
    return {"ok": True}


@router.post("/{persona_id}/toggle-publish")
async def toggle_publish(
    persona_id: str,
    _: Any = Depends(require_admin),
) -> dict[str, Any]:
    try:
        persona = await asyncio.to_thread(toggle_publish_sync, persona_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    log_admin_action(
        "tutor_persona.toggle_publish",
        summary={"persona_id": persona_id, "is_published": persona["is_published"]},
    )
    return {"persona": persona}


@router.post("/{persona_id}/prompt-versions")
async def create_prompt_version(
    persona_id: str,
    body: PromptVersionRequest,
    _: Any = Depends(require_admin),
) -> dict[str, Any]:
    actor = get_current_user()
    try:
        persona = await asyncio.to_thread(
            create_prompt_version_sync,
            persona_id,
            system_prompt=body.system_prompt,
            change_note=body.change_note,
            created_by=actor.id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    log_admin_action("tutor_persona.prompt_version", summary={"persona_id": persona_id})
    return {"persona": persona}


@router.post("/{persona_id}/rollback/{version_id}")
async def rollback_prompt(
    persona_id: str,
    version_id: str,
    _: Any = Depends(require_admin),
) -> dict[str, Any]:
    try:
        persona = await asyncio.to_thread(rollback_prompt_sync, persona_id, version_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    log_admin_action(
        "tutor_persona.rollback",
        summary={"persona_id": persona_id, "version_id": version_id},
    )
    return {"persona": persona}


@router.post("/{persona_id}/test")
async def live_test_persona(
    persona_id: str,
    body: LiveTestRequest,
    _: Any = Depends(require_admin),
) -> dict[str, Any]:
    message = body.message.strip()
    if not message:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Message is required")
    try:
        system_prompt = await asyncio.to_thread(get_active_system_prompt_sync, persona_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    try:
        from aimtutor.services.llm import complete

        response = await complete(message, system_prompt=system_prompt)
        reply = str(response)
    except Exception as exc:
        logger.exception("Persona live test failed")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"LLM test failed: {exc}",
        ) from exc
    return {"reply": reply, "system_prompt": system_prompt}
