"""One-time migration from the local SQLite chat DB to Postgres."""

from __future__ import annotations

import argparse
import sqlite3
from typing import Any

from psycopg2.extras import execute_values

from aimtutor.services.path_service import get_path_service
from aimtutor.services.session.postgres_store import get_postgres_session_store


TABLES = (
    "sessions",
    "messages",
    "turns",
    "turn_events",
    "notebook_entries",
    "notebook_categories",
    "notebook_entry_categories",
)


def _rows(conn: sqlite3.Connection, table: str) -> list[dict[str, Any]]:
    cur = conn.execute(f"SELECT * FROM {table}")  # nosec B608
    names = [desc[0] for desc in cur.description]
    return [dict(zip(names, row, strict=False)) for row in cur.fetchall()]


def migrate_sqlite_to_postgres(*, clear_existing: bool = False) -> dict[str, int]:
    sqlite_path = get_path_service().get_chat_history_db()
    if not sqlite_path.exists():
        return {table: 0 for table in TABLES}

    store = get_postgres_session_store()
    counts: dict[str, int] = {}

    with sqlite3.connect(sqlite_path) as source, store._connect() as target:  # noqa: SLF001
        source.row_factory = sqlite3.Row
        with target.cursor() as cur:
            if clear_existing:
                cur.execute(
                    """
                    TRUNCATE TABLE
                        notebook_entry_categories,
                        notebook_categories,
                        notebook_entries,
                        turn_events,
                        turns,
                        messages,
                        sessions
                    RESTART IDENTITY CASCADE
                    """
                )

            session_rows = _rows(source, "sessions")
            execute_values(
                cur,
                """
                    INSERT INTO sessions (
                        id, title, created_at, updated_at, compressed_summary,
                        summary_up_to_msg_id, preferences_json
                    )
                    VALUES %s
                    ON CONFLICT (id) DO UPDATE SET
                        title = EXCLUDED.title,
                        created_at = EXCLUDED.created_at,
                        updated_at = EXCLUDED.updated_at,
                        compressed_summary = EXCLUDED.compressed_summary,
                        summary_up_to_msg_id = EXCLUDED.summary_up_to_msg_id,
                        preferences_json = EXCLUDED.preferences_json
                    """,
                [
                    (
                        row["id"],
                        row["title"],
                        row["created_at"],
                        row["updated_at"],
                        row.get("compressed_summary") or "",
                        row.get("summary_up_to_msg_id") or 0,
                        row.get("preferences_json") or "{}",
                    )
                    for row in session_rows
                ],
            )
            counts["sessions"] = len(session_rows)

            message_rows = _rows(source, "messages")
            execute_values(
                cur,
                """
                    INSERT INTO messages (
                        id, session_id, role, content, capability, events_json,
                        attachments_json, metadata_json, created_at, parent_message_id
                    )
                    VALUES %s
                    ON CONFLICT (id) DO UPDATE SET
                        session_id = EXCLUDED.session_id,
                        role = EXCLUDED.role,
                        content = EXCLUDED.content,
                        capability = EXCLUDED.capability,
                        events_json = EXCLUDED.events_json,
                        attachments_json = EXCLUDED.attachments_json,
                        metadata_json = EXCLUDED.metadata_json,
                        created_at = EXCLUDED.created_at,
                        parent_message_id = EXCLUDED.parent_message_id
                    """,
                [
                    (
                        row["id"],
                        row["session_id"],
                        row["role"],
                        row.get("content") or "",
                        row.get("capability") or "",
                        row.get("events_json") or "",
                        row.get("attachments_json") or "",
                        row.get("metadata_json") or "{}",
                        row["created_at"],
                        row.get("parent_message_id"),
                    )
                    for row in message_rows
                ],
            )
            counts["messages"] = len(message_rows)

            turn_rows = _rows(source, "turns")
            execute_values(
                cur,
                """
                    INSERT INTO turns (
                        id, session_id, capability, status, error,
                        created_at, updated_at, finished_at
                    )
                    VALUES %s
                    ON CONFLICT (id) DO UPDATE SET
                        session_id = EXCLUDED.session_id,
                        capability = EXCLUDED.capability,
                        status = EXCLUDED.status,
                        error = EXCLUDED.error,
                        created_at = EXCLUDED.created_at,
                        updated_at = EXCLUDED.updated_at,
                        finished_at = EXCLUDED.finished_at
                    """,
                [
                    (
                        row["id"],
                        row["session_id"],
                        row.get("capability") or "",
                        row.get("status") or "completed",
                        row.get("error") or "",
                        row["created_at"],
                        row["updated_at"],
                        row.get("finished_at"),
                    )
                    for row in turn_rows
                ],
            )
            counts["turns"] = len(turn_rows)

            turn_event_rows = _rows(source, "turn_events")
            execute_values(
                cur,
                """
                    INSERT INTO turn_events (
                        id, turn_id, seq, type, source, stage, content,
                        metadata_json, timestamp, created_at
                    )
                    VALUES %s
                    ON CONFLICT (turn_id, seq) DO UPDATE SET
                        type = EXCLUDED.type,
                        source = EXCLUDED.source,
                        stage = EXCLUDED.stage,
                        content = EXCLUDED.content,
                        metadata_json = EXCLUDED.metadata_json,
                        timestamp = EXCLUDED.timestamp,
                        created_at = EXCLUDED.created_at
                    """,
                [
                    (
                        row["id"],
                        row["turn_id"],
                        row["seq"],
                        row["type"],
                        row.get("source") or "",
                        row.get("stage") or "",
                        row.get("content") or "",
                        row.get("metadata_json") or "{}",
                        row["timestamp"],
                        row["created_at"],
                    )
                    for row in turn_event_rows
                ],
                page_size=1000,
            )
            counts["turn_events"] = len(turn_event_rows)

            for row in _rows(source, "notebook_entries"):
                cur.execute(
                    """
                    INSERT INTO notebook_entries (
                        id, session_id, turn_id, question_id, question,
                        question_type, options_json, correct_answer, explanation,
                        difficulty, user_answer, user_answer_images_json,
                        is_correct, bookmarked, followup_session_id, ai_judgment,
                        created_at, updated_at
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (session_id, turn_id, question_id) DO UPDATE SET
                        question = EXCLUDED.question,
                        question_type = EXCLUDED.question_type,
                        options_json = EXCLUDED.options_json,
                        correct_answer = EXCLUDED.correct_answer,
                        explanation = EXCLUDED.explanation,
                        difficulty = EXCLUDED.difficulty,
                        user_answer = EXCLUDED.user_answer,
                        user_answer_images_json = EXCLUDED.user_answer_images_json,
                        is_correct = EXCLUDED.is_correct,
                        bookmarked = EXCLUDED.bookmarked,
                        followup_session_id = EXCLUDED.followup_session_id,
                        ai_judgment = EXCLUDED.ai_judgment,
                        updated_at = EXCLUDED.updated_at
                    """,
                    (
                        row["id"],
                        row["session_id"],
                        row.get("turn_id") or "",
                        row["question_id"],
                        row["question"],
                        row.get("question_type") or "",
                        row.get("options_json") or "{}",
                        row.get("correct_answer") or "",
                        row.get("explanation") or "",
                        row.get("difficulty") or "",
                        row.get("user_answer") or "",
                        row.get("user_answer_images_json") or "[]",
                        row.get("is_correct") or 0,
                        row.get("bookmarked") or 0,
                        row.get("followup_session_id") or "",
                        row.get("ai_judgment") or "",
                        row["created_at"],
                        row["updated_at"],
                    ),
                )
            counts["notebook_entries"] = len(_rows(source, "notebook_entries"))

            for row in _rows(source, "notebook_categories"):
                cur.execute(
                    """
                    INSERT INTO notebook_categories (id, name, created_at)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (id) DO UPDATE SET
                        name = EXCLUDED.name,
                        created_at = EXCLUDED.created_at
                    """,
                    (row["id"], row["name"], row["created_at"]),
                )
            counts["notebook_categories"] = len(_rows(source, "notebook_categories"))

            for row in _rows(source, "notebook_entry_categories"):
                cur.execute(
                    """
                    INSERT INTO notebook_entry_categories (entry_id, category_id)
                    VALUES (%s, %s)
                    ON CONFLICT DO NOTHING
                    """,
                    (row["entry_id"], row["category_id"]),
                )
            counts["notebook_entry_categories"] = len(
                _rows(source, "notebook_entry_categories")
            )

            for table in ("messages", "turn_events", "notebook_entries", "notebook_categories"):
                cur.execute(
                    "SELECT setval(pg_get_serial_sequence(%s, 'id'), COALESCE(MAX(id), 1), true) FROM "
                    + table,
                    (table,),
                )
            target.commit()

    return counts


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--clear-existing", action="store_true")
    args = parser.parse_args()
    counts = migrate_sqlite_to_postgres(clear_existing=args.clear_existing)
    for table, count in counts.items():
        print(f"{table}: {count}")


if __name__ == "__main__":
    main()
