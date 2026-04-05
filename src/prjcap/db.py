from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from dataclasses import asdict
from datetime import datetime
from pathlib import Path
from typing import Iterable, Optional

from prjcap.models import Project, Task, TaskWithProject


def _parse_dt(s: Optional[str]) -> Optional[datetime]:
    if s is None:
        return None
    # sqlite datetime('now') yields "YYYY-MM-DD HH:MM:SS"
    return datetime.fromisoformat(s)


def _row_to_project(row: sqlite3.Row) -> Project:
    return Project(
        id=row["id"],
        name=row["name"],
        chat_url=row["chat_url"],
        instruction_prefix=row["instruction_prefix"],
        agent_tail=row["agent_tail"],
    )


def _row_to_task(row: sqlite3.Row) -> Task:
    return Task(
        id=row["id"],
        project_id=row["project_id"],
        task_text=row["task_text"],
        input_source=row["input_source"],
        status=row["status"],
        created_at=_parse_dt(row["created_at"]) or datetime.now(),
        sent_at=_parse_dt(row["sent_at"]),
        done_at=_parse_dt(row["done_at"]),
        agent_response=row["agent_response"],
    )


def make_connection(db_path: Path) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


def init_db(db_path: Path) -> None:
    conn = make_connection(db_path)
    try:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS projects (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              name TEXT NOT NULL UNIQUE,
              chat_url TEXT NOT NULL,
              instruction_prefix TEXT NOT NULL,
              agent_tail TEXT,
              created_at TEXT NOT NULL DEFAULT (datetime('now')),
              updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS tasks (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
              task_text TEXT NOT NULL,
              input_source TEXT NOT NULL,
              status TEXT NOT NULL DEFAULT 'open'
                CHECK(status IN ('open','sent','done')),
              created_at TEXT NOT NULL DEFAULT (datetime('now')),
              sent_at TEXT NULL,
              done_at TEXT NULL,
              agent_response TEXT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_tasks_project_status
              ON tasks(project_id, status);
            """
        )
        conn.commit()
    finally:
        conn.close()


def _utc_now_sql() -> str:
    # sqlite uses local time for datetime('now'); that's enough for a console tracker.
    return "datetime('now')"


def upsert_project(db_path: Path, *, name: str, chat_url: str, instruction_prefix: str, agent_tail: str | None = None) -> Project:
    conn = make_connection(db_path)
    try:
        conn.execute(
            """
            INSERT INTO projects(name, chat_url, instruction_prefix, agent_tail, created_at, updated_at)
            VALUES(?, ?, ?, ?, datetime('now'), datetime('now'))
            ON CONFLICT(name) DO UPDATE SET
              chat_url=excluded.chat_url,
              instruction_prefix=excluded.instruction_prefix,
              agent_tail=excluded.agent_tail,
              updated_at=datetime('now');
            """,
            (name, chat_url, instruction_prefix, agent_tail),
        )
        conn.commit()
        row = conn.execute("SELECT id, name, chat_url, instruction_prefix, agent_tail FROM projects WHERE name = ?", (name,)).fetchone()
        assert row is not None
        return _row_to_project(row)
    finally:
        conn.close()


def list_projects(db_path: Path) -> list[Project]:
    conn = make_connection(db_path)
    try:
        rows = conn.execute("SELECT id, name, chat_url, instruction_prefix, agent_tail FROM projects ORDER BY name ASC").fetchall()
        return [_row_to_project(r) for r in rows]
    finally:
        conn.close()


def get_project_by_name(db_path: Path, name: str) -> Project | None:
    conn = make_connection(db_path)
    try:
        row = conn.execute(
            "SELECT id, name, chat_url, instruction_prefix, agent_tail FROM projects WHERE name = ?",
            (name,),
        ).fetchone()
        return _row_to_project(row) if row else None
    finally:
        conn.close()


def create_task(
    db_path: Path,
    *,
    project_id: int,
    task_text: str,
    input_source: str,
) -> Task:
    conn = make_connection(db_path)
    try:
        conn.execute(
            """
            INSERT INTO tasks(project_id, task_text, input_source, status, created_at)
            VALUES(?, ?, ?, 'open', datetime('now'));
            """,
            (project_id, task_text, input_source),
        )
        conn.commit()
        task_id = conn.execute("SELECT last_insert_rowid();").fetchone()[0]
        row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
        assert row is not None
        return _row_to_task(row)
    finally:
        conn.close()


def get_task_with_project(db_path: Path, task_id: int) -> TaskWithProject:
    conn = make_connection(db_path)
    try:
        row = conn.execute(
            """
            SELECT
              t.id, t.project_id, t.task_text, t.input_source, t.status,
              t.created_at, t.sent_at, t.done_at, t.agent_response,
              p.id as project_id2, p.name, p.chat_url, p.instruction_prefix
            FROM tasks t
            JOIN projects p ON p.id = t.project_id
            WHERE t.id = ?;
            """,
            (task_id,),
        ).fetchone()
        if row is None:
            raise ValueError(f"Task with id={task_id} not found")

        # Note: both p.id and t.project_id are present; we explicitly take project_id2 for Project.
        project = Project(
            id=row["project_id2"],
            name=row["name"],
            chat_url=row["chat_url"],
            instruction_prefix=row["instruction_prefix"],
            agent_tail=row["agent_tail"],
        )
        task = _row_to_task(row)
        return TaskWithProject(task=task, project=project)
    finally:
        conn.close()


def mark_task_sent(db_path: Path, task_id: int) -> None:
    conn = make_connection(db_path)
    try:
        conn.execute(
            f"""
            UPDATE tasks
            SET status='sent', sent_at={_utc_now_sql()}
            WHERE id = ? AND status IN ('open');
            """,
            (task_id,),
        )
        conn.commit()
    finally:
        conn.close()


def mark_task_done(db_path: Path, task_id: int, agent_response: str) -> None:
    conn = make_connection(db_path)
    try:
        conn.execute(
            f"""
            UPDATE tasks
            SET status='done', done_at={_utc_now_sql()}, agent_response=?
            WHERE id = ? AND status IN ('open','sent');
            """,
            (agent_response, task_id),
        )
        conn.commit()
    finally:
        conn.close()


def list_tasks(
    db_path: Path,
    *,
    project_name: str | None = None,
    status: str | None = None,
    limit: int | None = None,
) -> list[TaskWithProject]:
    conn = make_connection(db_path)
    try:
        params: list[object] = []
        where = []
        join = "JOIN projects p ON p.id = t.project_id"

        if project_name:
            where.append("p.name = ?")
            params.append(project_name)
        if status:
            where.append("t.status = ?")
            params.append(status)

        where_sql = (" WHERE " + " AND ".join(where)) if where else ""
        limit_sql = f" LIMIT {int(limit)}" if limit else ""

        rows = conn.execute(
            f"""
            SELECT
              t.id, t.project_id, t.task_text, t.input_source, t.status,
              t.created_at, t.sent_at, t.done_at, t.agent_response,
              p.id as project_id2, p.name, p.chat_url, p.instruction_prefix
            FROM tasks t
            {join}
            {where_sql}
            ORDER BY t.created_at DESC
            {limit_sql};
            """,
            params,
        ).fetchall()

        result: list[TaskWithProject] = []
        for r in rows:
            project = Project(
                id=r["project_id2"],
                name=r["name"],
                chat_url=r["chat_url"],
                instruction_prefix=r["instruction_prefix"],
                agent_tail=r["agent_tail"],
            )
            task = _row_to_task(r)
            result.append(TaskWithProject(task=task, project=project))
        return result
    finally:
        conn.close()

