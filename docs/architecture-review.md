# prjcap — Анализ архитектуры и статус рефакторинга

**Дата:** 2026-04-06
**Версия:** 1.2.0
**Объём:** ~3 200 строк (JS: ~2 300, CSS: ~910, JSON: 28)

---

## 1. Текущая структура проекта

```
extension/
├── manifest.json                (28 строк)     — MV3 манифест
├── background.js                (~197 строк)   — Service Worker: открытие чата, вставка промпта
├── popup.html + popup.js + popup.css           — Popup (управление задачами, экспорт/импорт)
├── timeline.html + timeline.css                — Полностраничный таймлайн
├── timeline/
│   ├── app.js                   (~185 строк)   — Инициализация, события, хоткеи, чат/копирование
│   ├── render.js                (~275 строк)   — Рендеринг карточек, сетки, фильтров
│   ├── drag-drop.js             (~184 строк)   — Drag & Drop (event delegation)
│   ├── modal.js                 (~198 строк)   — CRUD модальное окно задач + toggle done
│   ├── project-modal.js         (~138 строк)   — CRUD модальное окно проектов
│   ├── voice.js                 (~265 строк)   — SaluteSpeech: запись, конвертация, распознавание
│   ├── state.js                 (~40 строк)    — Общее mutable state (объект tl), persistTasks/Projects
│   ├── date-nav.js              (~23 строки)   — Навигация по датам
│   └── ui.js                    (~12 строк)    — Toast-уведомления
├── shared/
│   ├── storage.js               (~34 строки)   — chrome.storage обёртка, uid()
│   ├── message-builder.js       (~17 строк)    — Сборка промпта (prefix + task + tail)
│   ├── colors.js                (~29 строк)    — PROJECT_COLORS, hashStr, projColor, hexRgba
│   ├── date-utils.js            (~56 строк)    — fmtD, t2m, m2t, slot2time, fmtDateRu, dowRu
│   └── base.css                 (~26 строк)    — :root переменные, *, .hidden
└── icon{16,32,48,128}.png
```

### Архитектурная схема

```
                 shared/
              ┌─────────────────────────┐
              │ storage.js   colors.js  │
              │ date-utils  base.css    │
              │ message-builder.js      │
              └──┬──────────┬──────────┘
                 │          │
   ┌─────────────┘          └──────────────┐
   │                                       │
┌──┴──────────┐  chrome.runtime.onMessage ┌┴──────────────┐
│  popup.js   │ ◄──────────────────────► │ background.js  │
│  (imports:  │                           │ (imports:      │
│   shared/*) │                           │  shared/*)     │
└─────────────┘                           └────────────────┘
                                                  │
                    chrome.storage.local           │
                         ▲                       │
                         │                       │
┌────────────────────────┴────────────────────────┐
│              timeline/ modules                  │
│  ┌──────────┐  ┌────────────┐  ┌───────────┐  │
│  │ app.js   │──│ render.js  │  │ state.js  │  │
│  │ (init,   │  │ (cards,    │  │ (tl obj,  │  │
│  │  chat,   │  │  grid)     │  │  persist) │  │
│  │  copy)   │  └────────────┘  └───────────┘  │
│  ├──────────┤  ┌────────────┐  ┌───────────┐  │
│  │date-nav  │  │drag-drop.js│  │ modal.js  │  │
│  │(nav)     │  │ (DnD via   │  │ (task CRUD│  │
│  ├──────────┤  │  delegation│  │  events)  │  │
│  │ voice.js │  └────────────┘  └───────────┘  │
│  │ (Sber)   │  ┌────────────┐                  │
│  ├──────────┤  │project-    │                  │
│  │ ui.js    │  │modal.js    │                  │
│  │ (toast)  │  │(proj CRUD) │                  │
│  └──────────┘  └────────────┘                  │
└────────────────────────────────────────────────┘
```

### Ключевые архитектурные решения

- **Event delegation** — обработчики кликов на карточках привязаны к родительским контейнерам (`taskLayer`, `unscheduledList`) через `data-task-id`. Избегает циклических зависимостей между модулями.
- **Объектное mutable state** (`tl` в `state.js`) — вместо scattered `let` переменных. ES module `let` exports read-only из других модулей, поэтому используется мутабельный объект.
- **Нет циклических импортов** — граф зависимостей направленный: `app.js → render.js → state.js → shared/*`.
- **Чистое разделение модалок** — задачи (`modal.js`) и проекты (`project-modal.js`) в отдельных модулях.

---

## 2. Результаты рефакторинга P1

### ✅ 2.1. Разбить `timeline.js` на модули

God-файл (1 052 строки) разбит на 9 модулей. Максимальный размер: 275 строк (render.js) вместо 1 052.

### ✅ 2.2. Вынести общее в `shared/`

3 shared-модуля (`colors.js`, `date-utils.js`, `base.css`) устранили дублирование между popup и timeline.

### ✅ 2.3. Сузить `host_permissions`

Удалены `http://*/*` и `https://api.groq.com/*`. Остались только `smartspeech.sber.ru` и `ngw.devices.sberbank.ru`.

### ✅ 2.4. Удалить дублирующий storage в `background.js`

`background.js` импортирует `loadState`/`saveState` из `shared/storage.js`.

---

## 3. История развития

### P1: Рефакторинг модулей ✅
- Разбиение god-файла, shared-модули, сужение permissions

### P1.1: UI-улучшения ✅
- Кнопка «✓ Сделано» на карточках задач
- Текстовое поле в модалке увеличено до 12 строк
- Перенос текста внутри карточек таймлайна

### P1.2: Ресайз панели ✅
- Перетаскиваемый разделитель для панели «Нераспределённые»
- Ширина сохраняется в localStorage

### P1.3: Проекты и чат на Timeline ✅
- CRUD проектов через модалку на странице таймлайна (не теряется при потере фокуса)
- Кнопка 💬 на карточке — открыть чат агента и вставить промпт
- Кнопка 📋 на карточке — скопировать промпт в буфер
- Задержка вставки промпта 3 секунды (ожидание JS чата)

### P1.4: Удаление CLI ✅
- Удалён Python CLI (`src/prjcap/`, `pyproject.toml`)
- Репозиторий содержит только Chromium-расширение

---

## 4. Оставшиеся задачи

### Приоритет 2: Средний

#### 4.1. TypeScript / JSDoc
Добавить `tsconfig.json` с `"allowJs": true` и `"checkJs": true`. Начать переводить `shared/` модули.

#### 4.2. ESLint + Prettier
```json
{
  "extends": ["eslint:recommended"],
  "env": { "browser": true, "es2022": true, "webextensions": true },
  "parserOptions": { "ecmaVersion": 2022, "sourceType": "module" }
}
```

#### 4.3. Вынести SVG-иконки
SVG микрофона и настроек в `timeline/voice.js` — вынести в отдельный модуль или HTML-шаблон.

#### 4.4. Очистка модели данных
- Не ставить `doneAt: undefined`, а удалять ключ
- Ограничить переходы статусов
- Добавить version-поле для миграций

### Приоритет 3: Низкий

#### 4.5. Бандлер (Vite)

#### 4.6. Базовые тесты
Кандидаты: `hashStr()`, `projColor()`, `fmtD()`, `t2m()`, `slot2time()`, `buildTaskMessage()`.

---

## 5. Рекомендации

1. **Не вводить React/Vue/Svelte** — для расширения такого размера vanilla JS с ES-модулями достаточен.
2. **Не менять структуру `chrome.storage.local` без миграции** — данные пользователей хранятся там.
3. **Не удалять `pasteInjectFn` из background.js** — она нужна для сериализации через `chrome.scripting.executeScript`.
