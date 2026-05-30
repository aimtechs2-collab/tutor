"""Course, module, lesson, enrollment, and progress persistence."""

from __future__ import annotations

import asyncio
import logging
import re
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from aimtutor.services.db import connect
from aimtutor.services.quota import _get_user_plan_limits_sync

logger = logging.getLogger(__name__)

PLAN_RANK = {"free": 0, "basic": 1, "pro": 2, "premium": 3}


def _iso_timestamp(value: Any) -> str:
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).isoformat()
    return str(value or "")


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", (value or "").lower()).strip("-")
    return slug or f"item-{uuid4().hex[:8]}"


def plan_can_access(user_plan: str, required_plan: str) -> bool:
    return PLAN_RANK.get(user_plan, 0) >= PLAN_RANK.get(required_plan, 0)


def _course_row(row: dict[str, Any], **extra: Any) -> dict[str, Any]:
    payload = {
        "id": str(row["id"]),
        "slug": str(row["slug"]),
        "title": str(row["title"]),
        "description": str(row.get("description") or ""),
        "is_published": bool(row.get("is_published", False)),
        "required_plan": str(row.get("required_plan") or "free"),
        "sort_order": int(row.get("sort_order") or 0),
        "created_by": str(row.get("created_by") or ""),
        "created_at": _iso_timestamp(row.get("created_at")),
        "updated_at": _iso_timestamp(row.get("updated_at")),
    }
    payload.update(extra)
    return payload


def _module_row(row: dict[str, Any], **extra: Any) -> dict[str, Any]:
    payload = {
        "id": str(row["id"]),
        "course_id": str(row["course_id"]),
        "title": str(row["title"]),
        "sort_order": int(row.get("sort_order") or 0),
        "created_at": _iso_timestamp(row.get("created_at")),
        "updated_at": _iso_timestamp(row.get("updated_at")),
    }
    payload.update(extra)
    return payload


def _lesson_row(row: dict[str, Any], **extra: Any) -> dict[str, Any]:
    payload = {
        "id": str(row["id"]),
        "module_id": str(row["module_id"]),
        "title": str(row["title"]),
        "slug": str(row["slug"]),
        "content": str(row.get("content") or ""),
        "content_type": str(row.get("content_type") or "markdown"),
        "sort_order": int(row.get("sort_order") or 0),
        "duration_min": int(row.get("duration_min") or 0),
        "created_at": _iso_timestamp(row.get("created_at")),
        "updated_at": _iso_timestamp(row.get("updated_at")),
    }
    payload.update(extra)
    return payload


def _course_stats_sync(course_id: str) -> dict[str, Any]:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT
                COUNT(*) AS enrollment_count,
                COUNT(*) FILTER (WHERE status = 'completed') AS completed_count
            FROM course_enrollments
            WHERE course_id = %s
            """,
            (course_id,),
        )
        enroll = dict(cur.fetchone())
        cur.execute(
            """
            SELECT COUNT(*) AS lesson_count
            FROM lessons l
            JOIN course_modules m ON m.id = l.module_id
            WHERE m.course_id = %s
            """,
            (course_id,),
        )
        lesson_count = int(cur.fetchone()["lesson_count"])
    enrollment_count = int(enroll["enrollment_count"])
    completed_count = int(enroll["completed_count"])
    completion_rate = (completed_count / enrollment_count * 100.0) if enrollment_count else 0.0
    return {
        "enrollment_count": enrollment_count,
        "completed_count": completed_count,
        "completion_rate": round(completion_rate, 1),
        "lesson_count": lesson_count,
    }


def list_admin_courses_sync() -> list[dict[str, Any]]:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, slug, title, description, is_published, required_plan,
                   sort_order, created_by, created_at, updated_at
            FROM courses
            ORDER BY sort_order ASC, created_at DESC
            """
        )
        rows = cur.fetchall()
    results = []
    for row in rows:
        course = _course_row(dict(row))
        course.update(_course_stats_sync(course["id"]))
        results.append(course)
    return results


def get_course_by_id_sync(course_id: str) -> dict[str, Any] | None:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, slug, title, description, is_published, required_plan,
                   sort_order, created_by, created_at, updated_at
            FROM courses WHERE id = %s
            """,
            (course_id,),
        )
        row = cur.fetchone()
    if not row:
        return None
    course = _course_row(dict(row))
    course.update(_course_stats_sync(course_id))
    return course


def get_course_by_slug_sync(slug: str, *, published_only: bool = False) -> dict[str, Any] | None:
    with connect() as conn, conn.cursor() as cur:
        if published_only:
            cur.execute(
                """
                SELECT id, slug, title, description, is_published, required_plan,
                       sort_order, created_by, created_at, updated_at
                FROM courses WHERE slug = %s AND is_published = TRUE
                """,
                (slug,),
            )
        else:
            cur.execute(
                """
                SELECT id, slug, title, description, is_published, required_plan,
                       sort_order, created_by, created_at, updated_at
                FROM courses WHERE slug = %s
                """,
                (slug,),
            )
        row = cur.fetchone()
    return _course_row(dict(row)) if row else None


def _course_tree_sync(course_id: str) -> list[dict[str, Any]]:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, course_id, title, sort_order, created_at, updated_at
            FROM course_modules
            WHERE course_id = %s
            ORDER BY sort_order ASC, created_at ASC
            """,
            (course_id,),
        )
        modules = [_module_row(dict(row)) for row in cur.fetchall()]
        for module in modules:
            cur.execute(
                """
                SELECT id, module_id, title, slug, content, content_type,
                       sort_order, duration_min, created_at, updated_at
                FROM lessons
                WHERE module_id = %s
                ORDER BY sort_order ASC, created_at ASC
                """,
                (module["id"],),
            )
            module["lessons"] = [_lesson_row(dict(row)) for row in cur.fetchall()]
    return modules


def create_course_sync(
    *,
    title: str,
    description: str,
    is_published: bool,
    required_plan: str,
    sort_order: int,
    created_by: str,
    slug: str | None = None,
) -> dict[str, Any]:
    course_id = f"course_{uuid4().hex}"
    course_slug = slugify(slug or title)
    with connect() as conn, conn.cursor() as cur:
        cur.execute("SELECT 1 FROM courses WHERE slug = %s", (course_slug,))
        if cur.fetchone():
            course_slug = f"{course_slug}-{uuid4().hex[:6]}"
        cur.execute(
            """
            INSERT INTO courses (
                id, slug, title, description, is_published, required_plan,
                sort_order, created_by, created_at, updated_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, now(), now())
            RETURNING id, slug, title, description, is_published, required_plan,
                      sort_order, created_by, created_at, updated_at
            """,
            (course_id, course_slug, title, description, is_published, required_plan, sort_order, created_by),
        )
        row = dict(cur.fetchone())
        conn.commit()
    return _course_row(row)


def update_course_sync(course_id: str, **fields: Any) -> dict[str, Any] | None:
    allowed = {"title", "description", "is_published", "required_plan", "sort_order", "slug"}
    updates = {key: value for key, value in fields.items() if key in allowed and value is not None}
    if not updates:
        return get_course_by_id_sync(course_id)
    if "slug" in updates:
        updates["slug"] = slugify(str(updates["slug"]))
    set_clause = ", ".join(f"{key} = %s" for key in updates)
    params = list(updates.values()) + [course_id]
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            f"""
            UPDATE courses
            SET {set_clause}, updated_at = now()
            WHERE id = %s
            RETURNING id, slug, title, description, is_published, required_plan,
                      sort_order, created_by, created_at, updated_at
            """,
            params,
        )
        row = cur.fetchone()
        conn.commit()
    return _course_row(dict(row)) if row else None


def delete_course_sync(course_id: str) -> bool:
    with connect() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM courses WHERE id = %s", (course_id,))
        deleted = cur.rowcount > 0
        conn.commit()
    return deleted


def create_module_sync(*, course_id: str, title: str, sort_order: int = 0) -> dict[str, Any]:
    module_id = f"mod_{uuid4().hex}"
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO course_modules (id, course_id, title, sort_order, created_at, updated_at)
            VALUES (%s, %s, %s, %s, now(), now())
            RETURNING id, course_id, title, sort_order, created_at, updated_at
            """,
            (module_id, course_id, title, sort_order),
        )
        row = dict(cur.fetchone())
        conn.commit()
    module = _module_row(row)
    module["lessons"] = []
    return module


def update_module_sync(module_id: str, **fields: Any) -> dict[str, Any] | None:
    allowed = {"title", "sort_order"}
    updates = {key: value for key, value in fields.items() if key in allowed and value is not None}
    if not updates:
        return None
    set_clause = ", ".join(f"{key} = %s" for key in updates)
    params = list(updates.values()) + [module_id]
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            f"""
            UPDATE course_modules
            SET {set_clause}, updated_at = now()
            WHERE id = %s
            RETURNING id, course_id, title, sort_order, created_at, updated_at
            """,
            params,
        )
        row = cur.fetchone()
        conn.commit()
    return _module_row(dict(row)) if row else None


def delete_module_sync(module_id: str) -> bool:
    with connect() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM course_modules WHERE id = %s", (module_id,))
        deleted = cur.rowcount > 0
        conn.commit()
    return deleted


def create_lesson_sync(
    *,
    module_id: str,
    title: str,
    slug: str | None = None,
    content: str = "",
    content_type: str = "markdown",
    sort_order: int = 0,
    duration_min: int = 0,
) -> dict[str, Any]:
    lesson_id = f"lesson_{uuid4().hex}"
    lesson_slug = slugify(slug or title)
    with connect() as conn, conn.cursor() as cur:
        cur.execute("SELECT 1 FROM lessons WHERE module_id = %s AND slug = %s", (module_id, lesson_slug))
        if cur.fetchone():
            lesson_slug = f"{lesson_slug}-{uuid4().hex[:6]}"
        cur.execute(
            """
            INSERT INTO lessons (
                id, module_id, title, slug, content, content_type,
                sort_order, duration_min, created_at, updated_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, now(), now())
            RETURNING id, module_id, title, slug, content, content_type,
                      sort_order, duration_min, created_at, updated_at
            """,
            (lesson_id, module_id, title, lesson_slug, content, content_type, sort_order, duration_min),
        )
        row = dict(cur.fetchone())
        conn.commit()
    return _lesson_row(row)


def update_lesson_sync(lesson_id: str, **fields: Any) -> dict[str, Any] | None:
    allowed = {"title", "slug", "content", "content_type", "sort_order", "duration_min"}
    updates = {key: value for key, value in fields.items() if key in allowed and value is not None}
    if not updates:
        return None
    if "slug" in updates:
        updates["slug"] = slugify(str(updates["slug"]))
    set_clause = ", ".join(f"{key} = %s" for key in updates)
    params = list(updates.values()) + [lesson_id]
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            f"""
            UPDATE lessons
            SET {set_clause}, updated_at = now()
            WHERE id = %s
            RETURNING id, module_id, title, slug, content, content_type,
                      sort_order, duration_min, created_at, updated_at
            """,
            params,
        )
        row = cur.fetchone()
        conn.commit()
    return _lesson_row(dict(row)) if row else None


def delete_lesson_sync(lesson_id: str) -> bool:
    with connect() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM lessons WHERE id = %s", (lesson_id,))
        deleted = cur.rowcount > 0
        conn.commit()
    return deleted


def list_catalog_sync(user_id: str, user_plan: str) -> list[dict[str, Any]]:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT c.id, c.slug, c.title, c.description, c.is_published, c.required_plan,
                   c.sort_order, c.created_by, c.created_at, c.updated_at,
                   e.status AS enrollment_status,
                   e.enrolled_at,
                   (
                       SELECT COUNT(*)
                       FROM lessons l
                       JOIN course_modules m ON m.id = l.module_id
                       WHERE m.course_id = c.id
                   ) AS lesson_count
            FROM courses c
            LEFT JOIN course_enrollments e ON e.course_id = c.id AND e.user_id = %s
            WHERE c.is_published = TRUE
            ORDER BY c.sort_order ASC, c.created_at DESC
            """,
            (user_id,),
        )
        rows = cur.fetchall()
    results = []
    for row in rows:
        record = dict(row)
        required_plan = str(record.get("required_plan") or "free")
        course = _course_row(record)
        course["lesson_count"] = int(record.get("lesson_count") or 0)
        course["accessible"] = plan_can_access(user_plan, required_plan)
        course["enrollment_status"] = record.get("enrollment_status")
        course["enrolled_at"] = _iso_timestamp(record.get("enrolled_at")) if record.get("enrolled_at") else None
        results.append(course)
    return results


def get_course_detail_sync(course_id: str, user_id: str) -> dict[str, Any] | None:
    course = get_course_by_id_sync(course_id)
    if not course:
        return None
    modules = _course_tree_sync(course_id)
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT status, enrolled_at, completed_at
            FROM course_enrollments
            WHERE user_id = %s AND course_id = %s
            """,
            (user_id, course_id),
        )
        enrollment = cur.fetchone()
        cur.execute(
            """
            SELECT lesson_id, completed, completed_at
            FROM lesson_progress
            WHERE user_id = %s AND lesson_id IN (
                SELECT l.id FROM lessons l
                JOIN course_modules m ON m.id = l.module_id
                WHERE m.course_id = %s
            )
            """,
            (user_id, course_id),
        )
        progress_map = {
            str(row["lesson_id"]): {
                "completed": bool(row["completed"]),
                "completed_at": _iso_timestamp(row.get("completed_at")) if row.get("completed_at") else None,
            }
            for row in cur.fetchall()
        }
    for module in modules:
        for lesson in module.get("lessons", []):
            lesson["progress"] = progress_map.get(lesson["id"], {"completed": False, "completed_at": None})
    course["modules"] = modules
    course["enrollment"] = (
        {
            "status": str(enrollment["status"]),
            "enrolled_at": _iso_timestamp(enrollment.get("enrolled_at")),
            "completed_at": _iso_timestamp(enrollment.get("completed_at")) if enrollment.get("completed_at") else None,
        }
        if enrollment
        else None
    )
    return course


def enroll_user_sync(user_id: str, course_id: str) -> dict[str, Any]:
    enrollment_id = f"enroll_{uuid4().hex}"
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO course_enrollments (id, user_id, course_id, status, enrolled_at)
            VALUES (%s, %s, %s, 'active', now())
            ON CONFLICT (user_id, course_id) DO UPDATE
            SET status = 'active', enrolled_at = course_enrollments.enrolled_at
            RETURNING id, user_id, course_id, status, enrolled_at, completed_at
            """,
            (enrollment_id, user_id, course_id),
        )
        row = dict(cur.fetchone())
        conn.commit()
    return {
        "id": str(row["id"]),
        "user_id": str(row["user_id"]),
        "course_id": str(row["course_id"]),
        "status": str(row["status"]),
        "enrolled_at": _iso_timestamp(row.get("enrolled_at")),
        "completed_at": _iso_timestamp(row.get("completed_at")) if row.get("completed_at") else None,
    }


def _maybe_complete_course_sync(user_id: str, course_id: str) -> None:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT COUNT(*) AS total
            FROM lessons l
            JOIN course_modules m ON m.id = l.module_id
            WHERE m.course_id = %s
            """,
            (course_id,),
        )
        total = int(cur.fetchone()["total"])
        if total <= 0:
            return
        cur.execute(
            """
            SELECT COUNT(*) AS done
            FROM lesson_progress lp
            JOIN lessons l ON l.id = lp.lesson_id
            JOIN course_modules m ON m.id = l.module_id
            WHERE lp.user_id = %s AND m.course_id = %s AND lp.completed = TRUE
            """,
            (user_id, course_id),
        )
        done = int(cur.fetchone()["done"])
        if done >= total:
            cur.execute(
                """
                UPDATE course_enrollments
                SET status = 'completed', completed_at = now()
                WHERE user_id = %s AND course_id = %s
                """,
                (user_id, course_id),
            )
            conn.commit()


def complete_lesson_sync(user_id: str, lesson_id: str) -> dict[str, Any]:
    progress_id = f"prog_{uuid4().hex}"
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT m.course_id
            FROM lessons l
            JOIN course_modules m ON m.id = l.module_id
            WHERE l.id = %s
            """,
            (lesson_id,),
        )
        row = cur.fetchone()
        if not row:
            raise ValueError("Lesson not found")
        course_id = str(row["course_id"])
        cur.execute(
            """
            INSERT INTO lesson_progress (id, user_id, lesson_id, completed, completed_at)
            VALUES (%s, %s, %s, TRUE, now())
            ON CONFLICT (user_id, lesson_id) DO UPDATE
            SET completed = TRUE, completed_at = now()
            RETURNING id, user_id, lesson_id, completed, completed_at
            """,
            (progress_id, user_id, lesson_id),
        )
        progress = dict(cur.fetchone())
        conn.commit()
    _maybe_complete_course_sync(user_id, course_id)
    return {
        "id": str(progress["id"]),
        "user_id": str(progress["user_id"]),
        "lesson_id": str(progress["lesson_id"]),
        "completed": bool(progress["completed"]),
        "completed_at": _iso_timestamp(progress.get("completed_at")),
        "course_id": course_id,
    }


def course_analytics_sync(course_id: str) -> dict[str, Any]:
    stats = _course_stats_sync(course_id)
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT COUNT(DISTINCT lp.user_id) AS learners_with_progress,
                   COUNT(*) FILTER (WHERE lp.completed = TRUE) AS completed_lessons
            FROM lesson_progress lp
            JOIN lessons l ON l.id = lp.lesson_id
            JOIN course_modules m ON m.id = l.module_id
            WHERE m.course_id = %s
            """,
            (course_id,),
        )
        progress = dict(cur.fetchone())
        cur.execute(
            """
            SELECT e.enrolled_at::date AS day, COUNT(*) AS enrollments
            FROM course_enrollments e
            WHERE e.course_id = %s
            GROUP BY e.enrolled_at::date
            ORDER BY day ASC
            LIMIT 30
            """,
            (course_id,),
        )
        enrollments_by_day = [
            {"day": _iso_timestamp(row["day"]), "count": int(row["enrollments"])}
            for row in cur.fetchall()
        ]
    lesson_count = stats["lesson_count"]
    completed_lessons = int(progress.get("completed_lessons") or 0)
    learners = int(progress.get("learners_with_progress") or 0)
    avg_lessons_completed = (completed_lessons / learners) if learners else 0.0
    return {
        **stats,
        "learners_with_progress": learners,
        "completed_lessons": completed_lessons,
        "avg_lessons_completed": round(avg_lessons_completed, 2),
        "avg_completion_rate": round((avg_lessons_completed / lesson_count * 100.0) if lesson_count else 0.0, 1),
        "enrollments_by_day": enrollments_by_day,
    }


async def user_plan_name(user_id: str) -> str:
    limits = await asyncio.to_thread(_get_user_plan_limits_sync, user_id)
    return str(limits.get("plan_name") or "free")
