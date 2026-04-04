from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Optional


@dataclass(frozen=True)
class Project:
    id: int
    name: str
    chat_url: str
    instruction_prefix: str
    agent_tail: Optional[str] = None


@dataclass(frozen=True)
class Task:
    id: int
    project_id: int
    task_text: str
    input_source: str  # "text" | "voice"
    status: str  # "open" | "sent" | "done"
    created_at: datetime
    sent_at: Optional[datetime]
    done_at: Optional[datetime]
    agent_response: Optional[str]


@dataclass(frozen=True)
class TaskWithProject:
    task: Task
    project: Project

