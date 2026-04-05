from __future__ import annotations


DEFAULT_AGENT_TAIL = (
    "После выполнения: сделай коммит и `push` в репозиторий. "
    "Затем кратко опиши результат, чтобы пользователь мог его проверить."
)


def build_task_message(*, instruction_prefix: str, task_text: str, agent_tail: str | None = None) -> str:
    prefix = (instruction_prefix or "").strip()
    tail = (agent_tail or "").strip()
    task = (task_text or "").strip()
    if prefix:
        header = prefix
    else:
        header = "You are an AI agent."

    tail_part = tail if tail else DEFAULT_AGENT_TAIL

    # Keep it stable to simplify future UI/Flutter reuse.
    return "\n\n".join(
        [
            header,
            "TASK:",
            task,
            tail_part,
        ]
    ).strip() + "\n"

