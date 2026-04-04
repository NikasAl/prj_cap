from __future__ import annotations


DEFAULT_AGENT_TAIL = (
    "После выполнения: сделай коммит и `push` в репозиторий. "
    "Затем кратко опиши результат, чтобы пользователь мог его проверить."
)


def build_task_message(*, instruction_prefix: str, task_text: str) -> str:
    prefix = (instruction_prefix or "").strip()
    task = (task_text or "").strip()
    if prefix:
        header = prefix
    else:
        header = "You are an AI agent."

    # Keep it stable to simplify future UI/Flutter reuse.
    return "\n\n".join(
        [
            header,
            "TASK:",
            task,
            DEFAULT_AGENT_TAIL,
        ]
    ).strip() + "\n"

