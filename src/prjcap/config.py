from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any


def repo_root() -> Path:
    # src/prjcap/config.py -> src/prjcap -> src -> repo root
    return Path(__file__).resolve().parents[2]


def default_db_path() -> Path:
    return repo_root() / "data" / "prjcap.sqlite3"


def state_path() -> Path:
    # Minimal persistent UI state (e.g. last used project).
    #
    # Keep it inside the repository workspace so it works in restricted environments/sandboxes.
    override = os.environ.get("PRJ_CAP_STATE_PATH")
    if override:
        return Path(override).expanduser().resolve()
    return repo_root() / "data" / "state.json"


@dataclass(frozen=True)
class CliState:
    last_project: str | None = None


def load_state() -> CliState:
    p = state_path()
    if not p.exists():
        return CliState()
    try:
        payload: Any = json.loads(p.read_text(encoding="utf-8"))
        return CliState(last_project=payload.get("last_project"))
    except Exception:
        return CliState()


def save_state(state: CliState) -> None:
    p = state_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps({"last_project": state.last_project}, ensure_ascii=False, indent=2), encoding="utf-8")

