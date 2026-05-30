"""Admin and current-user APIs for the optional multi-user layer."""

from __future__ import annotations

from copy import deepcopy
from pathlib import Path
import shutil
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from aimtutor.api.routers.auth import (
    require_admin,
    require_conversations,
    require_tutor_manager,
    require_users_read,
)
from aimtutor.services.analytics import get_analytics_overview_sync
from aimtutor.knowledge.manager import KnowledgeBaseManager
from aimtutor.services.config.model_catalog import ModelCatalogService
from aimtutor.services.skill.service import SkillService

from .audit import log_admin_action
from .context import get_current_user
from .conversations_admin import get_admin_conversation, list_admin_conversations
from .flagged_conversations import create_flag
from .grants import load_grant, save_grant
from .identity import get_user_by_id, list_user_info
from .knowledge_access import admin_kb_base_dir, list_visible_knowledge_bases
from .model_access import redacted_model_access
from .paths import MULTI_USER_ROOT, get_admin_path_service
from .skill_access import assigned_skill_ids

router = APIRouter()


class GrantPayload(BaseModel):
    grant: dict[str, Any]


class SpaceAssignPayload(BaseModel):
    source: str
    target: str | None = None


class FlagRequest(BaseModel):
    user_id: str
    reason: str = ""
    flag_type: str


def _admin_catalog_summary() -> dict[str, list[dict[str, Any]]]:
    catalog = ModelCatalogService(
        path=get_admin_path_service().get_settings_file("model_catalog")
    ).load()
    out: dict[str, list[dict[str, Any]]] = {"llm": [], "embedding": [], "search": []}
    for service, state in (catalog.get("services") or {}).items():
        if service not in out:
            continue
        for profile in state.get("profiles", []) or []:
            profile_id = str(profile.get("id") or "")
            if service == "search":
                out[service].append(
                    {
                        "profile_id": profile_id,
                        "name": profile.get("name") or profile.get("provider") or profile_id,
                        "provider": profile.get("provider", ""),
                    }
                )
                continue
            models = []
            for model in profile.get("models", []) or []:
                models.append(
                    {
                        "model_id": model.get("id", ""),
                        "name": model.get("name") or model.get("model") or model.get("id"),
                        "model": model.get("model", ""),
                    }
                )
            out[service].append(
                {
                    "profile_id": profile_id,
                    "name": profile.get("name") or profile_id,
                    "models": models,
                }
            )
    return out


def _admin_kb_summary() -> list[dict[str, Any]]:
    manager = KnowledgeBaseManager(base_dir=str(admin_kb_base_dir()))
    return [
        {
            "resource_id": f"admin:kb:{name}",
            "name": name,
            "source": "admin",
        }
        for name in manager.list_knowledge_bases()
    ]


def _admin_skill_summary() -> list[dict[str, Any]]:
    root = get_admin_path_service().get_workspace_dir() / "skills"
    service = SkillService(root=root)
    return [item.to_dict() for item in service.list_skills()]


def _safe_relative_dir(root: Path, value: str) -> Path:
    candidate = (root / str(value or "").strip()).resolve()
    try:
        candidate.relative_to(root.resolve())
    except ValueError as exc:
        raise HTTPException(status_code=403, detail="Path escapes workspace root") from exc
    return candidate


def _require_assignable_user(user_id: str) -> tuple[str, dict[str, Any]]:
    user_record = get_user_by_id(user_id)
    if user_record is None:
        raise HTTPException(status_code=404, detail="User not found")
    username, record = user_record
    if str(record.get("role") or "user") == "admin":
        raise HTTPException(
            status_code=403,
            detail="Admin users use the main workspace and cannot receive assignments.",
        )
    return username, record


@router.get("/me/access")
async def my_access() -> dict[str, Any]:
    user = get_current_user()
    return {
        "user": user.public_dict(),
        "models": {} if user.is_admin else redacted_model_access(user.id),
        "knowledge_bases": list_visible_knowledge_bases(),
        "skills": [] if user.is_admin else sorted(assigned_skill_ids(user.id)),
        "spaces": [] if user.is_admin else load_grant(user.id).get("spaces", []),
    }


@router.get("/admin/analytics/overview")
async def admin_analytics_overview(
    period: str = "30d",
    _: object = Depends(require_admin),
) -> dict[str, Any]:
    if period not in {"7d", "30d", "90d"}:
        raise HTTPException(status_code=400, detail="period must be 7d, 30d, or 90d")
    import asyncio

    return await asyncio.to_thread(get_analytics_overview_sync, period)


@router.get("/admin/resources")
async def admin_resources(_: object = Depends(require_admin)) -> dict[str, Any]:
    return {
        "models": _admin_catalog_summary(),
        "knowledge_bases": _admin_kb_summary(),
        "skills": _admin_skill_summary(),
    }


@router.get("/users/{user_id}/grants")
async def get_user_grants(user_id: str, _: object = Depends(require_admin)) -> dict[str, Any]:
    _require_assignable_user(user_id)
    return {"grant": load_grant(user_id)}


@router.put("/users/{user_id}/grants")
async def put_user_grants(
    user_id: str,
    payload: GrantPayload,
    _: object = Depends(require_admin),
) -> dict[str, Any]:
    _require_assignable_user(user_id)
    try:
        grant = save_grant(user_id, payload.grant)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    log_admin_action(
        "grant_set",
        target_user_id=user_id,
        summary={
            "model_count": sum(
                len(grant.get("models", {}).get(s, [])) for s in ("llm", "embedding", "search")
            ),
            "kb_count": len(grant.get("knowledge_bases", []) or []),
            "skill_count": len(grant.get("skills", []) or []),
        },
    )
    return {"grant": grant}


@router.get("/users")
async def multi_user_list_users(_: object = Depends(require_users_read)) -> dict[str, Any]:
    return {"users": list_user_info()}


@router.post("/users/{user_id}/spaces/assign")
async def assign_space_template(
    user_id: str,
    payload: SpaceAssignPayload,
    _: object = Depends(require_tutor_manager),
) -> dict[str, Any]:
    _require_assignable_user(user_id)

    admin_workspace = get_admin_path_service().get_workspace_dir()
    user_workspace = (MULTI_USER_ROOT / user_id / "user" / "workspace").resolve()
    source = _safe_relative_dir(admin_workspace, payload.source)
    if not source.exists() or not source.is_dir():
        raise HTTPException(status_code=404, detail="Source space/template not found")

    target_name = payload.target or source.name
    target = _safe_relative_dir(user_workspace, target_name)
    if target.exists():
        raise HTTPException(status_code=409, detail="Target already exists")
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(source, target)
    provenance = {
        "source": "admin",
        "source_path": payload.source,
        "assigned_by": get_current_user().username,
    }
    (target / ".aimtutor_provenance.json").write_text(
        __import__("json").dumps(provenance, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    grant = deepcopy(load_grant(user_id))
    grant.setdefault("spaces", []).append(
        {
            "space_id": target.name,
            "mode": "copy",
            "source": "admin",
            "provenance": provenance,
        }
    )
    save_grant(user_id, grant)
    log_admin_action(
        "space_assign",
        target_user_id=user_id,
        summary={"source": payload.source, "target": target.name},
    )
    return {"ok": True, "target": str(target.relative_to(user_workspace))}


@router.get("/admin/conversations")
async def admin_list_conversations(
    user_id: str | None = None,
    capability: str | None = None,
    search: str | None = None,
    flag_filter: str = "all",
    limit: int = 50,
    offset: int = 0,
    _: object = Depends(require_conversations),
) -> dict[str, Any]:
    conversations = await list_admin_conversations(
        user_id=user_id,
        capability=capability,
        search=search,
        flag_filter=flag_filter,
        limit=max(1, min(limit, 200)),
        offset=max(0, offset),
    )
    return {"conversations": conversations}


@router.get("/admin/conversations/{session_id}")
async def admin_get_conversation(
    session_id: str,
    user_id: str,
    _: object = Depends(require_conversations),
) -> dict[str, Any]:
    payload = await get_admin_conversation(session_id, user_id)
    if payload is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return payload


@router.post("/admin/conversations/{session_id}/flag")
async def admin_flag_conversation(
    session_id: str,
    body: FlagRequest,
    _: object = Depends(require_conversations),
) -> dict[str, Any]:
    actor = get_current_user()
    flag = await create_flag(
        session_id=session_id,
        user_id=body.user_id,
        flag_type=body.flag_type,
        reason=body.reason,
        flagged_by=actor.id,
    )
    log_admin_action(
        "flag_conversation",
        target_user_id=body.user_id,
        summary={
            "session_id": session_id,
            "flag_type": body.flag_type,
            "reason": body.reason,
            "flag_id": flag["id"],
        },
    )
    return {"ok": True, "flag": flag}


# ── Admin overview / audit / risk summary ────────────────────────────────

from aimtutor.api.routers.auth import require_admin  # noqa: E402 (already imported above)
import asyncio as _asyncio  # noqa: E402


@router.get("/admin/overview")
async def admin_overview(_: Any = Depends(require_admin)) -> dict[str, Any]:
    """Aggregated stats for the admin overview dashboard."""
    from aimtutor.multi_user.flagged_conversations import list_unresolved_flags
    from aimtutor.multi_user.audit import get_audit_log
    from aimtutor.services.quota import list_plans, list_plan_users

    users = list_user_info()
    active = [u for u in users if not u.get("disabled")]
    suspended = [u for u in users if u.get("disabled") and not u.get("banned")]
    banned = [u for u in users if u.get("banned")]
    admins = [u for u in active if u.get("role") == "admin"]

    # Flagged convs
    try:
        unresolved_flags = await list_unresolved_flags()
    except Exception:
        unresolved_flags = []

    # Recent audit actions
    try:
        recent_audit = get_audit_log(limit=5)
    except Exception:
        recent_audit = []

    # Plan distribution
    try:
        plans = await list_plans()
        plan_dist = [{"name": p["display_name"], "count": p["user_count"]} for p in plans]
    except Exception:
        plan_dist = []

    return {
        "users": {
            "total": len(active),
            "suspended": len(suspended),
            "banned": len(banned),
            "admins": len(admins),
        },
        "risk": {
            "unresolved_flags": len(unresolved_flags),
            "flag_types": _count_by(unresolved_flags, "flag_type"),
        },
        "plans": plan_dist,
        "recent_audit": recent_audit,
    }


def _count_by(items: list[dict], key: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for item in items:
        k = str(item.get(key, "unknown"))
        counts[k] = counts.get(k, 0) + 1
    return counts


@router.get("/admin/audit")
async def admin_audit_log(
    limit: int = 200,
    action: str | None = None,
    _: Any = Depends(require_admin),
) -> list[dict[str, Any]]:
    """Paginated admin audit log."""
    from aimtutor.multi_user.audit import get_audit_log
    return get_audit_log(limit=limit, action_filter=action or None)


@router.get("/admin/risk/flags")
async def admin_risk_flags(
    resolved: bool | None = None,
    _: Any = Depends(require_admin),
) -> list[dict[str, Any]]:
    """All flagged conversations, enriched with username."""
    from aimtutor.multi_user.flagged_conversations import list_unresolved_flags
    from aimtutor.services.db import connect

    try:
        if resolved is False or resolved is None:
            flags = await list_unresolved_flags()
        else:
            import asyncio
            def _all_flags():
                from aimtutor.services.db import connect as _c
                with _c() as conn, conn.cursor() as cur:
                    cur.execute(
                        "SELECT id,session_id,user_id,flag_type,reason,flagged_by,resolved,created_at "
                        "FROM flagged_conversations ORDER BY created_at DESC LIMIT 500"
                    )
                    return [dict(r) for r in cur.fetchall()]
            flags = await asyncio.to_thread(_all_flags)
    except Exception:
        flags = []

    users_by_id = {u.get("id", ""): u.get("username", "") for u in list_user_info()}
    for flag in flags:
        flag["username"] = users_by_id.get(flag.get("user_id", ""), "unknown")
        if hasattr(flag.get("created_at"), "isoformat"):
            flag["created_at"] = flag["created_at"].isoformat()
    return flags


@router.post("/admin/risk/flags/{flag_id}/resolve")
async def admin_resolve_flag(
    flag_id: str,
    _: Any = Depends(require_admin),
) -> dict[str, Any]:
    """Mark a flagged conversation as resolved."""
    import asyncio
    from aimtutor.multi_user.audit import log_admin_action

    def _resolve():
        from aimtutor.services.db import connect as _c
        with _c() as conn, conn.cursor() as cur:
            cur.execute(
                "UPDATE flagged_conversations SET resolved=TRUE WHERE id=%s RETURNING id",
                (flag_id,),
            )
            updated = cur.fetchone() is not None
            conn.commit()
        return updated

    updated = await asyncio.to_thread(_resolve)
    if not updated:
        raise HTTPException(status_code=404, detail="Flag not found")
    log_admin_action("resolve_flag", summary={"flag_id": flag_id})
    return {"ok": True}


@router.get("/admin/progress")
async def admin_progress(
    _: Any = Depends(require_admin),
) -> list[dict[str, Any]]:
    """Per-user progress stats for the progress analytics page."""
    from aimtutor.multi_user.context import reset_current_user, set_current_user
    from aimtutor.multi_user.models import CurrentUser
    from aimtutor.multi_user.paths import scope_for_user
    from aimtutor.services.session import get_session_store
    from aimtutor.services.quota import get_user_plan_limits
    from datetime import datetime, timezone

    users = list_user_info()
    results: list[dict[str, Any]] = []

    for user_info in users:
        uid = str(user_info.get("id", ""))
        username = str(user_info.get("username", uid))
        role = str(user_info.get("role", "user"))
        if not uid or user_info.get("disabled"):
            continue
        try:
            user = CurrentUser(
                id=uid, username=username, role=role,
                scope=scope_for_user(uid, is_admin=role == "admin"),
            )
            token = set_current_user(user)
            try:
                store = get_session_store()
                sessions = await store.list_sessions(limit=500, offset=0)
                quiz_sessions = [s for s in sessions if s.get("capability") in ("question", "quiz")]
                today = datetime.now(timezone.utc).date()
                active_dates = sorted(
                    {datetime.fromtimestamp(s.get("updated_at", 0), tz=timezone.utc).date()
                     for s in sessions if s.get("updated_at", 0) > 0},
                    reverse=True,
                )
                streak = 0
                for i, d in enumerate(active_dates):
                    if (today - d).days == i:
                        streak += 1
                    else:
                        break
                last_ts = max((s.get("updated_at", 0) for s in sessions), default=0)
                plan_limits = await get_user_plan_limits(uid)
                results.append({
                    "user_id": uid,
                    "username": username,
                    "plan_name": plan_limits.get("plan_name", "free"),
                    "total_sessions": len(sessions),
                    "quiz_sessions": len(quiz_sessions),
                    "voice_minutes": 0.0,
                    "streak_days": streak,
                    "last_active": (
                        datetime.fromtimestamp(last_ts, tz=timezone.utc).isoformat()
                        if last_ts else None
                    ),
                })
            finally:
                reset_current_user(token)
        except Exception as exc:
            logger.warning("admin_progress: failed for %s: %s", uid, exc)
    return sorted(results, key=lambda x: x.get("streak_days", 0), reverse=True)
