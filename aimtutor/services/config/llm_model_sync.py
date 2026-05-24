"""Live LLM model discovery for settings catalog profiles."""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
import hashlib
import re
from typing import Any

import httpx

from aimtutor.services.provider_registry import find_by_name


@dataclass(frozen=True, slots=True)
class ModelSyncResult:
    catalog: dict[str, Any]
    synced_profiles: int
    synced_models: int
    active_profile_id: str | None
    active_model_id: str | None
    errors: list[dict[str, str]]


_NON_CHAT_PATTERNS = (
    "embedding",
    "embed",
    "whisper",
    "tts",
    "speech",
    "audio",
    "transcrib",
    "moderation",
    "dall-e",
    "image",
    "vision-preview",
    "realtime",
    "live",
    "computer-use",
    "robotics",
    "rerank",
    "babbage",
    "davinci",
    "search",
)


def _model_id(profile_id: str, model_name: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", model_name).strip("-").lower()
    digest = hashlib.sha1(model_name.encode("utf-8")).hexdigest()[:8]
    slug = slug[:56].strip("-") or "model"
    return f"{profile_id}-{slug}-{digest}"


def _display_name(model_name: str) -> str:
    raw = model_name.removeprefix("models/")
    parts = [part for part in re.split(r"[-_/]+", raw) if part]
    return " ".join(part.upper() if part.lower() in {"gpt", "tts"} else part.capitalize() for part in parts)


def _normalize_model_name(provider: str, model_name: str) -> str:
    cleaned = str(model_name or "").strip()
    if provider == "gemini":
        cleaned = cleaned.removeprefix("models/")
    return cleaned


def _is_chat_model(provider: str, model_name: str) -> bool:
    name = model_name.lower()
    if any(pattern in name for pattern in _NON_CHAT_PATTERNS):
        return False
    if provider == "openai":
        return name.startswith(("gpt-", "o1", "o3", "o4", "o5", "chatgpt-"))
    if provider == "gemini":
        return name.startswith(("gemini-", "models/gemini-", "gemma-", "models/gemma-"))
    return True


def _best_model_score(provider: str, model_name: str) -> int:
    name = model_name.lower().removeprefix("models/")
    score = 0

    if provider == "openai":
        version = re.match(r"gpt-(\d+)(?:\.(\d+))?", name)
        if version:
            major = int(version.group(1))
            minor = int(version.group(2) or 0)
            score = max(score, (major * 1_000) + (minor * 100))
        ordered = (
            ("chat-latest", 1_000),
            ("gpt-5", 5_000),
            ("gpt-4.1", 4_100),
            ("gpt-4o", 4_000),
            ("o4", 4_800),
            ("o3", 4_600),
            ("gpt-4", 3_900),
            ("gpt-3.5", 2_000),
        )
    elif provider == "gemini":
        version = re.match(r"gemini-(\d+)(?:\.(\d+))?", name)
        if version:
            major = int(version.group(1))
            minor = int(version.group(2) or 0)
            score = max(score, (major * 1_000) + (minor * 100))
        ordered = (
            ("pro", 900),
            ("flash", 500),
            ("gemini-2.5-pro", 3_400),
            ("gemini-2.5-flash", 3_000),
            ("gemini-2.0-flash", 2_500),
            ("gemini-1.5-pro", 5_500),
            ("gemini-1.5-flash", 5_000),
            ("gemma", 3_000),
        )
    else:
        ordered = (
            ("pro", 6_000),
            ("reason", 5_800),
            ("chat", 5_000),
            ("instruct", 4_500),
            ("flash", 4_000),
        )

    for pattern, value in ordered:
        if pattern in name:
            score = max(score, value)

    if re.search(r"(^|[-_./])mini($|[-_./])", name) or "lite" in name or "nano" in name:
        score -= 600
    if re.search(r"(^|[-_./])pro($|[-_./])", name):
        score += 250
    if "codex" in name:
        score -= 800
    if "preview" in name or "experimental" in name or "exp" in name:
        score -= 900
    if "live" in name or "realtime" in name:
        score -= 1_400
    if provider == "openai" and "chat-latest" in name:
        score += 1_500
    if "latest" in name:
        score += 100
    return score


def _default_chat_model_score(provider: str, model_name: str) -> int:
    """Score models for the automatic active chat default.

    The catalog still sorts by capability via ``_best_model_score``. The active
    runtime default has a different job: it should start responding quickly for
    ordinary chat, and let the user opt into heavy/pro/reasoning models when a
    prompt actually needs them.
    """
    name = model_name.lower().removeprefix("models/")
    score = _best_model_score(provider, name)

    preferred_patterns: tuple[tuple[str, int], ...]
    if provider == "openai":
        preferred_patterns = (
            ("gpt-4.1-mini", 7_000),
            ("gpt-4o-mini", 6_800),
            ("gpt-5-mini", 6_600),
            ("gpt-4.1", 6_200),
            ("gpt-4o", 6_000),
            ("o4-mini", 5_600),
        )
    elif provider == "gemini":
        preferred_patterns = (
            ("gemini-2.5-flash", 7_000),
            ("gemini-2.0-flash", 6_700),
            ("gemini-flash-latest", 6_500),
            ("gemini-3.5-flash", 6_300),
            ("gemini-3-flash", 6_100),
            ("flash-lite", 5_700),
        )
    else:
        preferred_patterns = (
            ("flash", 6_200),
            ("mini", 6_000),
            ("lite", 5_800),
            ("chat", 5_500),
        )

    for pattern, value in preferred_patterns:
        if pattern in name:
            score = max(score, value)

    # These models are excellent, but they are poor defaults for interactive
    # chat because they trade latency/cost for maximum reasoning depth.
    if "chat-latest" in name:
        score -= 2_500
    if re.search(r"(^|[-_./])pro($|[-_./])", name):
        score -= 1_800
    if "preview" in name or "experimental" in name or "exp" in name:
        score -= 1_200
    if "codex" in name:
        score -= 1_200
    if re.search(r"(^|[-_./])(nano|lite)($|[-_./])", name):
        score -= 300
    return score


def _best_model_index(provider: str, models: list[dict[str, Any]]) -> int:
    if not models:
        return -1
    scored = [
        (_best_model_score(provider, str(model.get("model") or "")), -idx)
        for idx, model in enumerate(models)
    ]
    best_score, neg_index = max(scored)
    return -neg_index if best_score > 0 else 0


def _default_model_index(provider: str, models: list[dict[str, Any]]) -> int:
    if not models:
        return -1
    scored = [
        (_default_chat_model_score(provider, str(model.get("model") or "")), -idx)
        for idx, model in enumerate(models)
    ]
    best_score, neg_index = max(scored)
    return -neg_index if best_score > 0 else _best_model_index(provider, models)


def _resolved_models_url(profile: dict[str, Any]) -> str:
    binding = str(profile.get("binding") or "").strip()
    spec = find_by_name(binding)
    base = str(profile.get("base_url") or "").strip() or (spec.default_api_base if spec else "")
    if not base:
        raise ValueError("No base URL is configured for this provider.")
    return base.rstrip("/") + "/models"


async def _fetch_openai_compatible_models(profile: dict[str, Any]) -> list[str]:
    api_key = str(profile.get("api_key") or "").strip()
    if not api_key:
        raise ValueError("API key is required before syncing models.")
    url = _resolved_models_url(profile)
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(url, headers={"Authorization": f"Bearer {api_key}"})
    response.raise_for_status()
    payload = response.json()
    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, list):
        raise ValueError("Provider returned an unexpected model-list response.")
    ids: list[str] = []
    for item in data:
        if not isinstance(item, dict):
            continue
        model_id = str(item.get("id") or item.get("name") or "").strip()
        if model_id:
            ids.append(model_id)
    return ids


def _merge_models(profile_id: str, provider: str, existing: list[Any], fetched_ids: list[str]) -> list[dict[str, Any]]:
    existing_by_model = {
        str(model.get("model") or "").strip(): model
        for model in existing
        if isinstance(model, dict) and str(model.get("model") or "").strip()
    }
    next_models: list[dict[str, Any]] = []
    seen: set[str] = set()
    for raw_id in fetched_ids:
        model_name = _normalize_model_name(provider, raw_id)
        if not model_name or model_name in seen or not _is_chat_model(provider, raw_id):
            continue
        seen.add(model_name)
        previous = existing_by_model.get(model_name, {})
        next_model = {
            "id": str(previous.get("id") or _model_id(profile_id, model_name)),
            "name": str(previous.get("name") or _display_name(model_name)),
            "model": model_name,
        }
        for key in ("context_window", "context_window_source", "context_window_detected_at"):
            if previous.get(key):
                next_model[key] = previous[key]
        next_models.append(next_model)
    next_models.sort(
        key=lambda model: (
            -_best_model_score(provider, str(model.get("model") or "")),
            str(model.get("model") or ""),
        )
    )
    return next_models


async def sync_llm_models(
    catalog: dict[str, Any],
    *,
    profile_id: str | None = None,
) -> ModelSyncResult:
    """Return a catalog copy with live LLM model lists refreshed."""
    synced = deepcopy(catalog)
    service = synced.setdefault("services", {}).setdefault("llm", {})
    profiles = service.setdefault("profiles", [])
    errors: list[dict[str, str]] = []
    synced_profiles = 0
    synced_models = 0
    best_global: tuple[int, str, str] | None = None

    for profile in profiles:
        if not isinstance(profile, dict):
            continue
        current_profile_id = str(profile.get("id") or "").strip()
        if profile_id and current_profile_id != profile_id:
            continue

        provider = str(profile.get("binding") or "").strip()
        spec = find_by_name(provider)
        if not spec or spec.backend != "openai_compat":
            errors.append(
                {
                    "profile_id": current_profile_id,
                    "message": "Live model sync is only available for OpenAI-compatible providers.",
                }
            )
            continue

        try:
            fetched = await _fetch_openai_compatible_models(profile)
            models = _merge_models(
                current_profile_id,
                spec.name,
                profile.get("models", []),
                fetched,
            )
            if not models:
                raise ValueError("No chat-capable models were found in the provider response.")
            profile["models"] = models
            default_idx = _default_model_index(spec.name, models)
            best_model = models[default_idx]
            score = _default_chat_model_score(spec.name, str(best_model.get("model") or ""))
            if best_global is None or score > best_global[0]:
                best_global = (score, current_profile_id, str(best_model["id"]))
            synced_profiles += 1
            synced_models += len(models)
        except Exception as exc:
            errors.append({"profile_id": current_profile_id, "message": str(exc)})

    if best_global is not None:
        service["active_profile_id"] = best_global[1]
        service["active_model_id"] = best_global[2]

    return ModelSyncResult(
        catalog=synced,
        synced_profiles=synced_profiles,
        synced_models=synced_models,
        active_profile_id=service.get("active_profile_id"),
        active_model_id=service.get("active_model_id"),
        errors=errors,
    )


__all__ = ["ModelSyncResult", "sync_llm_models"]
