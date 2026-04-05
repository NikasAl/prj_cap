from __future__ import annotations

import argparse
import sys
import textwrap
from datetime import datetime
from pathlib import Path
from typing import Optional

from prjcap.browser_launcher import open_chat
from prjcap.config import CliState, default_db_path, load_state, save_state
from prjcap.db import (
    create_task,
    get_project_by_name,
    get_task_with_project,
    init_db,
    list_projects,
    list_tasks,
    mark_task_done,
    mark_task_sent,
    upsert_project,
)
from prjcap.message_builder import build_task_message
from prjcap.whisper_client import transcribe_from_microphone


def _repo_db(db_path_arg: str | None) -> Path:
    if db_path_arg:
        return Path(db_path_arg).expanduser().resolve()
    return default_db_path()


def _ensure_db(db_path: Path) -> None:
    init_db(db_path)


def _maybe_set_last_project(project_name: str) -> None:
    state = load_state()
    save_state(CliState(last_project=project_name))


def _print_projects(projects) -> None:
    if not projects:
        print("No projects yet.")
        return
    for p in projects:
        print(f'- {p.name} | chat_url={p.chat_url}')


def _truncate(s: str, max_len: int) -> str:
    s = (s or "").strip().replace("\n", " ")
    return s if len(s) <= max_len else s[: max_len - 3] + "..."


def cmd_init_db(args: argparse.Namespace) -> int:
    db_path = _repo_db(args.db)
    _ensure_db(db_path)
    print(f"DB initialized at: {db_path}")
    return 0


def cmd_projects_list(args: argparse.Namespace) -> int:
    db_path = _repo_db(args.db)
    _ensure_db(db_path)
    projects = list_projects(db_path)
    _print_projects(projects)
    return 0


def cmd_projects_add(args: argparse.Namespace) -> int:
    db_path = _repo_db(args.db)
    _ensure_db(db_path)

    agent_tail = args.agent_tail.strip() if args.agent_tail else None
    p = upsert_project(
        db_path,
        name=args.name.strip(),
        chat_url=args.chat_url.strip(),
        instruction_prefix=args.instruction_prefix.strip(),
        agent_tail=agent_tail,
    )
    _maybe_set_last_project(p.name)
    print(f'Project upserted: "{p.name}"')
    return 0


def _resolve_project_name(args: argparse.Namespace) -> str:
    if args.project:
        return args.project
    state = load_state()
    if state.last_project:
        return state.last_project
    raise ValueError("Project is required. Use --project or set last_project via projects add/create.")


def cmd_tasks_create(args: argparse.Namespace) -> int:
    db_path = _repo_db(args.db)
    _ensure_db(db_path)

    project_name = _resolve_project_name(args)
    project = get_project_by_name(db_path, project_name)
    if project is None:
        raise ValueError(f'Project not found: "{project_name}"')

    text: Optional[str] = args.text
    use_voice = bool(args.voice or args.audio_file)
    if use_voice:
        if text:
            raise ValueError("Use either --text or voice input (either --voice and microphone, or --audio-file).")

        if args.audio_file:
            from prjcap.whisper_client import transcribe_from_audio_file

            text = transcribe_from_audio_file(
                audio_path=Path(args.audio_file).expanduser().resolve(),
                whisper_model=args.whisper_model,
                language=args.language,
            )
        else:
            text = transcribe_from_microphone(
                duration_seconds=args.duration_seconds,
                whisper_model=args.whisper_model,
                language=args.language,
            )

    if not text or not text.strip():
        raise ValueError("Task text is empty.")

    task = create_task(
        db_path,
        project_id=project.id,
        task_text=text,
        input_source="voice" if use_voice else "text",
    )

    _maybe_set_last_project(project.name)
    print(f"Task created: id={task.id} status={task.status} project={project.name}")
    return 0


def cmd_tasks_send(args: argparse.Namespace) -> int:
    db_path = _repo_db(args.db)
    _ensure_db(db_path)

    task_with_project = get_task_with_project(db_path, args.task_id)
    task = task_with_project.task
    project = task_with_project.project

    message = build_task_message(
        instruction_prefix=project.instruction_prefix,
        agent_tail=project.agent_tail,
        task_text=task.task_text,
    )

    if task.status == "open":
        mark_task_sent(db_path, task.id)
    else:
        print(f"Warning: task status is '{task.status}', message will still be printed.")

    open_chat(project.chat_url)

    print("\n=== Paste this into the agent chat message field ===\n")
    print(message)
    print("=== End of message ===\n")
    return 0


def _read_response_from_stdin() -> str:
    print("Enter response text (finish with EOF, e.g. Ctrl+D):")
    return sys.stdin.read().strip()


def cmd_tasks_done(args: argparse.Namespace) -> int:
    db_path = _repo_db(args.db)
    _ensure_db(db_path)

    task_with_project = get_task_with_project(db_path, args.task_id)
    task = task_with_project.task

    response = args.response
    if response is None:
        response = _read_response_from_stdin()

    if not response.strip():
        raise ValueError("Response is empty.")

    if task.status != "done":
        mark_task_done(db_path, task.id, agent_response=response.strip())
    print(f"Task marked done: id={task.id}")
    return 0


def cmd_tasks_list(args: argparse.Namespace) -> int:
    db_path = _repo_db(args.db)
    _ensure_db(db_path)

    project_name: str | None = args.project
    if not project_name:
        state = load_state()
        project_name = state.last_project

    tasks = list_tasks(db_path, project_name=project_name, status=args.status, limit=args.limit)
    if not tasks:
        print("No tasks found.")
        return 0

    for twp in tasks:
        t = twp.task
        prefix = f"[{t.status}] id={t.id} project={twp.project.name} source={t.input_source}"
        print(prefix)
        print(f"  task: {_truncate(t.task_text, 180)}")
        if t.status == "done" and t.agent_response:
            print(f"  response: {_truncate(t.agent_response, 180)}")
        print("")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="prjcap",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        description="Project task tracker for agent-mode chat integration.",
    )
    parser.add_argument("--db", default=None, help="Path to SQLite DB (default: data/prjcap.sqlite3).")

    sub = parser.add_subparsers(dest="top_cmd", required=True)

    p_init = sub.add_parser("init-db", help="Initialize SQLite schema.")
    p_init.set_defaults(func=cmd_init_db)

    p_projects = sub.add_parser("projects", help="Projects management.")
    p_projects_sub = p_projects.add_subparsers(dest="projects_cmd", required=True)
    p_projects_list = p_projects_sub.add_parser("list", help="List projects.")
    p_projects_list.set_defaults(func=cmd_projects_list)

    p_projects_add = p_projects_sub.add_parser("add", help="Add or update a project.")
    p_projects_add.add_argument("--name", required=True)
    p_projects_add.add_argument("--chat-url", required=True)
    p_projects_add.add_argument("--instruction-prefix", required=True)
    p_projects_add.add_argument("--agent-tail", default=None, help="Optional agent tail (what to do after task completion).")
    p_projects_add.set_defaults(func=cmd_projects_add)

    p_tasks = sub.add_parser("tasks", help="Tasks management.")
    p_tasks_sub = p_tasks.add_subparsers(dest="tasks_cmd", required=True)

    p_tasks_create = p_tasks_sub.add_parser("create", help="Create a new task from text or voice.")
    p_tasks_create.add_argument("--project", default=None, help="Project name (optional: uses last_project).")
    p_tasks_create.add_argument("--text", default=None, help="Task text (mutually exclusive with --voice).")
    p_tasks_create.add_argument("--voice", action="store_true", help="Record from microphone and transcribe.")
    p_tasks_create.add_argument("--audio-file", default=None, help="Transcribe from an existing audio file (wav/mp3/...).")
    p_tasks_create.add_argument("--duration-seconds", type=int, default=20)
    p_tasks_create.add_argument("--whisper-model", default="base")
    p_tasks_create.add_argument("--language", default=None, help="Optional Whisper language hint (e.g. ru).")
    p_tasks_create.set_defaults(func=cmd_tasks_create)

    p_tasks_send = p_tasks_sub.add_parser("send", help="Open project chat and print message to paste.")
    p_tasks_send.add_argument("--task-id", type=int, required=True)
    p_tasks_send.set_defaults(func=cmd_tasks_send)

    p_tasks_done = p_tasks_sub.add_parser("done", help="Mark a task as completed (manual).")
    p_tasks_done.add_argument("--task-id", type=int, required=True)
    p_tasks_done.add_argument("--response", default=None, help="Agent response/summary. If omitted, read from stdin.")
    p_tasks_done.set_defaults(func=cmd_tasks_done)

    p_tasks_list = p_tasks_sub.add_parser("list", help="List tasks (filters supported).")
    p_tasks_list.add_argument("--project", default=None, help="Project name (default: last_project).")
    p_tasks_list.add_argument("--status", default="open", choices=["open", "sent", "done", "all"], help="Status filter.")
    p_tasks_list.add_argument("--limit", default=50, type=int)

    # Normalize status=all to None (db layer expects None).
    def _tasks_list_wrapper(ns: argparse.Namespace) -> int:
        if ns.status == "all":
            ns.status = None
        return cmd_tasks_list(ns)

    p_tasks_list.set_defaults(func=_tasks_list_wrapper)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return int(args.func(args))
    except KeyboardInterrupt:
        return 130
    except Exception as e:
        msg = textwrap.shorten(str(e), width=500, placeholder="...")
        print(f"Error: {msg}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

