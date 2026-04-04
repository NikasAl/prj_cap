# prjcap

Консольный трекер задач по проектам для agent-режима в браузере.

## Как запускать

Предполагается, что у вас есть venv `act_env_general` для Python-окружения, где уже установлены `whisper` и `torch`.

Пример:
```bash
act_env_general
pip install -e .
prjcap --help
```

## Поток

1. Создайте проект:
```bash
prjcap projects add --name "myproj" --chat-url "https://chat.z.ai/..." --instruction-prefix "..."
```

2. Создайте задачу (текст или голос):
```bash
prjcap tasks create --project "myproj" --text "Сделай ..."
prjcap tasks create --project "myproj" --voice
```

3. Отправьте задачу в agent-чат (CLI покажет сообщение для вставки):
```bash
prjcap tasks send --task-id 1
```

4. Отметьте выполнение вручную:
```bash
prjcap tasks done --task-id 1 --response "..."
```

