"""Course catalog, enrollment, and admin curriculum management."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from aimtutor.api.routers.auth import require_admin, require_auth
from aimtutor.multi_user.audit import log_admin_action
from aimtutor.multi_user.context import get_current_user
from aimtutor.services.courses import (
    complete_lesson_sync,
    course_analytics_sync,
    create_course_sync,
    create_lesson_sync,
    create_module_sync,
    delete_course_sync,
    delete_lesson_sync,
    delete_module_sync,
    enroll_user_sync,
    get_course_by_id_sync,
    get_course_by_slug_sync,
    get_course_detail_sync,
    list_admin_courses_sync,
    list_catalog_sync,
    plan_can_access,
    update_course_sync,
    update_lesson_sync,
    update_module_sync,
    user_plan_name,
    _course_tree_sync,
)

logger = logging.getLogger(__name__)

router = APIRouter()


class CourseCreateRequest(BaseModel):
    title: str
    description: str = ""
    slug: str | None = None
    is_published: bool = False
    required_plan: str = "free"
    sort_order: int = 0


class CourseUpdateRequest(BaseModel):
    title: str | None = None
    description: str | None = None
    slug: str | None = None
    is_published: bool | None = None
    required_plan: str | None = None
    sort_order: int | None = None


class ModuleRequest(BaseModel):
    title: str
    sort_order: int = 0


class LessonRequest(BaseModel):
    title: str
    slug: str | None = None
    content: str = ""
    content_type: str = "markdown"
    sort_order: int = 0
    duration_min: int = 0


@router.get("/courses")
async def list_courses(_: Any = Depends(require_auth)) -> dict[str, Any]:
    user = get_current_user()
    plan = await user_plan_name(user.id)
    courses = await asyncio.to_thread(list_catalog_sync, user.id, plan)
    return {"courses": courses, "plan_name": plan}


@router.get("/courses/{slug}")
async def get_course(slug: str, _: Any = Depends(require_auth)) -> dict[str, Any]:
    user = get_current_user()
    course = await asyncio.to_thread(get_course_by_slug_sync, slug, published_only=True)
    if course is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")
    plan = await user_plan_name(user.id)
    if not plan_can_access(plan, course["required_plan"]):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Plan upgrade required")
    detail = await asyncio.to_thread(get_course_detail_sync, course["id"], user.id)
    return {"course": detail}


@router.post("/courses/{slug}/enroll")
async def enroll_in_course(slug: str, _: Any = Depends(require_auth)) -> dict[str, Any]:
    user = get_current_user()
    course = await asyncio.to_thread(get_course_by_slug_sync, slug, published_only=True)
    if course is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")
    plan = await user_plan_name(user.id)
    if not plan_can_access(plan, course["required_plan"]):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Plan upgrade required")
    enrollment = await asyncio.to_thread(enroll_user_sync, user.id, course["id"])
    return {"enrollment": enrollment}


@router.post("/courses/lessons/{lesson_id}/complete")
async def complete_lesson(lesson_id: str, _: Any = Depends(require_auth)) -> dict[str, Any]:
    user = get_current_user()
    try:
        progress = await asyncio.to_thread(complete_lesson_sync, user.id, lesson_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return {"progress": progress}


@router.get("/admin/courses")
async def admin_list_courses(_: Any = Depends(require_admin)) -> dict[str, Any]:
    courses = await asyncio.to_thread(list_admin_courses_sync)
    return {"courses": courses}


@router.post("/admin/courses")
async def admin_create_course(
    body: CourseCreateRequest,
    _: Any = Depends(require_admin),
) -> dict[str, Any]:
    actor = get_current_user()
    course = await asyncio.to_thread(
        create_course_sync,
        title=body.title.strip(),
        description=body.description.strip(),
        is_published=body.is_published,
        required_plan=body.required_plan,
        sort_order=body.sort_order,
        created_by=actor.id,
        slug=body.slug,
    )
    log_admin_action("course_create", summary={"course_id": course["id"], "title": course["title"]})
    return {"course": course}


@router.get("/admin/courses/{course_id}")
async def admin_get_course(course_id: str, _: Any = Depends(require_admin)) -> dict[str, Any]:
    course = await asyncio.to_thread(get_course_by_id_sync, course_id)
    if course is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")
    modules = await asyncio.to_thread(_course_tree_sync, course_id)
    course["modules"] = modules
    return {"course": course}


@router.put("/admin/courses/{course_id}")
async def admin_update_course(
    course_id: str,
    body: CourseUpdateRequest,
    _: Any = Depends(require_admin),
) -> dict[str, Any]:
    updated = await asyncio.to_thread(
        update_course_sync,
        course_id,
        **body.model_dump(exclude_unset=True),
    )
    if updated is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")
    log_admin_action("course_update", summary={"course_id": course_id, "title": updated["title"]})
    return {"course": updated}


@router.delete("/admin/courses/{course_id}")
async def admin_delete_course(course_id: str, _: Any = Depends(require_admin)) -> dict[str, bool]:
    deleted = await asyncio.to_thread(delete_course_sync, course_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")
    log_admin_action("course_delete", summary={"course_id": course_id})
    return {"ok": True}


@router.post("/admin/courses/{course_id}/modules")
async def admin_create_module(
    course_id: str,
    body: ModuleRequest,
    _: Any = Depends(require_admin),
) -> dict[str, Any]:
    course = await asyncio.to_thread(get_course_by_id_sync, course_id)
    if course is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")
    module = await asyncio.to_thread(
        create_module_sync,
        course_id=course_id,
        title=body.title.strip(),
        sort_order=body.sort_order,
    )
    log_admin_action("course_module_create", summary={"course_id": course_id, "module_id": module["id"]})
    return {"module": module}


@router.put("/admin/modules/{module_id}")
async def admin_update_module(
    module_id: str,
    body: ModuleRequest,
    _: Any = Depends(require_admin),
) -> dict[str, Any]:
    module = await asyncio.to_thread(
        update_module_sync,
        module_id,
        title=body.title.strip(),
        sort_order=body.sort_order,
    )
    if module is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Module not found")
    return {"module": module}


@router.delete("/admin/modules/{module_id}")
async def admin_delete_module(module_id: str, _: Any = Depends(require_admin)) -> dict[str, bool]:
    deleted = await asyncio.to_thread(delete_module_sync, module_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Module not found")
    return {"ok": True}


@router.post("/admin/modules/{module_id}/lessons")
async def admin_create_lesson(
    module_id: str,
    body: LessonRequest,
    _: Any = Depends(require_admin),
) -> dict[str, Any]:
    lesson = await asyncio.to_thread(
        create_lesson_sync,
        module_id=module_id,
        title=body.title.strip(),
        slug=body.slug,
        content=body.content,
        content_type=body.content_type,
        sort_order=body.sort_order,
        duration_min=body.duration_min,
    )
    log_admin_action("course_lesson_create", summary={"module_id": module_id, "lesson_id": lesson["id"]})
    return {"lesson": lesson}


@router.put("/admin/lessons/{lesson_id}")
async def admin_update_lesson(
    lesson_id: str,
    body: LessonRequest,
    _: Any = Depends(require_admin),
) -> dict[str, Any]:
    lesson = await asyncio.to_thread(
        update_lesson_sync,
        lesson_id,
        title=body.title.strip(),
        slug=body.slug,
        content=body.content,
        content_type=body.content_type,
        sort_order=body.sort_order,
        duration_min=body.duration_min,
    )
    if lesson is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lesson not found")
    return {"lesson": lesson}


@router.delete("/admin/lessons/{lesson_id}")
async def admin_delete_lesson(lesson_id: str, _: Any = Depends(require_admin)) -> dict[str, bool]:
    deleted = await asyncio.to_thread(delete_lesson_sync, lesson_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lesson not found")
    return {"ok": True}


@router.get("/admin/courses/{course_id}/analytics")
async def admin_course_analytics(course_id: str, _: Any = Depends(require_admin)) -> dict[str, Any]:
    course = await asyncio.to_thread(get_course_by_id_sync, course_id)
    if course is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")
    analytics = await asyncio.to_thread(course_analytics_sync, course_id)
    return {"course": course, "analytics": analytics}
