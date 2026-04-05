# prjcap — Анализ архитектуры и статус рефакторинга

**Дата:** 2026-04-05  
**Версия:** 1.1.0 (post-refactor)  
**Объём:** ~2 900 строк (JS: ~2 000, CSS: ~910, JSON: 28)

---

## 1. Текущая структура проекта (после рефакторинга P1)

```
extension/
├── manifest.json                (28 строк)     — MV3 манифест
├── background.js                (196 строк)    — Service Worker (упрощённый)
├── popup.html + popup.js + popup.css           — Popup (управление задачами)
├── timeline.html + timeline.css                — Полностраничный таймлайн
├── timeline/
│   ├── app.js                   (66 строк)     — Инициализация, события, хоткеи
│   ├── render.js                (275 строк)    — Рендеринг карточек, сетки, фильтров
│   ├── drag-drop.js             (184 строк)    — Drag & Drop (event delegation)
│   ├── modal.js                 (197 строк)    — CRUD модальное окно + toggle done
│   ├── voice.js                 (265 строк)    — SaluteSpeech: запись, конвертация, распознавание
│   ├── state.js                 (35 строк)     — Общее mutable state (объект tl)
│   ├── date-nav.js              (23 строки)    — Навигация по датам
│   └── ui.js                    (12 строк)     — Toast-уведомления
├── shared/
│   ├── storage.js               (34 строки)    — chrome.storage обёртка
│   ├── message-builder.js       (17 строк)     — Сборка промпта
│   ├── colors.js                (29 строк)     — PROJECT_COLORS, hashStr, projColor, hexRgba
│   ├── date-utils.js            (56 строк)     — fmtD, t2m, m2t, slot2time, MONTHS_RU, DOW_RU
│   └── base.css                 (26 строк)     — :root переменные, *, .hidden
└── icon{16,32,48,128}.png
```

### Архитектурная схема (after P1 refactor)

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
│  │ (init)   │  │ (cards,    │  │ (tl obj)  │  │
│  │          │  │  grid)     │  │           │  │
│  ├──────────┤  └────────────┘  └───────────┘  │
│  │date-nav  │  ┌────────────┐  ┌───────────┐  │
│  │(nav)     │  │drag-drop.js│  │ modal.js  │  │
│  ├──────────┤  │ (DnD via   │  │ (CRUD,    │  │
│  │ voice.js │  │  delegation│  │  events)  │  │
│  │ (Sber)   │  └────────────┘  └───────────┘  │
│  ├──────────┤                                  │
│  │ ui.js    │  shared/* (colors, date-utils)   │
│  │ (toast)  │                                  │
│  └──────────┘                                  │
└────────────────────────────────────────────────┘
```

### Ключевые архитектурные решения

- **Event delegation** — обработчики кликов на карточках привязаны к родительским контейнерам (`taskLayer`, `unscheduledList`) через `data-task-id`. Избегает циклических зависимостей между модулями.
- **Объектное mutable state** (`tl` в `state.js`) — вместо scattered `let` переменных. ES module `let` exports read-only из других модулей, поэтому используется мутабельный объект.
- **Нет циклических импортов** — граф зависимостей направленный: `app.js → render.js → state.js → shared/*`.

---

## 2. Результаты рефакторинга P1

### ✅ 3.1. Разбить `timeline.js` на модули

**Статус: DONE**

God-файл `timeline.js` (1 052 строки, 6 доменов) разбит на 7 модулей:

| Модуль | Строк | Доменов | Ответственность |
|--------|-------|---------|-----------------|
| `timeline/app.js` | 66 | 1 | Инициализация, event listeners, хоткеи |
| `timeline/render.js` | 275 | 1 | Рендеринг карточек, сетки слотов, фильтров, now-line |
| `timeline/drag-drop.js` | 184 | 1 | DnD между слотами, днями, sidebar |
| `timeline/modal.js` | 197 | 1 | CRUD модальное окно, toggle done |
| `timeline/voice.js` | 265 | 1 | SaluteSpeech запись, WebM→WAV, распознавание |
| `timeline/state.js` | 35 | 1 | Общий mutable state |
| `timeline/date-nav.js` | 23 | 1 | Навигация по датам |
| `timeline/ui.js` | 12 | 1 | Toast-уведомления |

Максимальный размер модуля: 275 строк (render.js) вместо 1 052 строк в одном файле.

### ✅ 3.2. Вынести общее в `shared/`

**Статус: DONE**

Создано 3 новых shared-модуля:

| Модуль | Что содержит |
|--------|-------------|
| `shared/colors.js` | `PROJECT_COLORS`, `hashStr()`, `projColor()`, `hexRgba()` |
| `shared/date-utils.js` | `fmtD()`, `fmtDateRu()`, `dowRu()`, `t2m()`, `m2t()`, `slot2time()`, `time2slot()`, `todayStr()`, `MONTHS_RU`, `DOW_RU`, `SLOT_H`, `PER_HOUR`, `TOTAL_SLOTS`, `SLOT_MIN` |
| `shared/base.css` | `:root` переменные (`--bg`, `--panel`, `--border`, `--text`, `--muted`, `--accent`, `--accent-hi`, `--danger`, `--ok`), `* { box-sizing }`, `.hidden` |

`popup.js` удалено ~30 строк дублирующего кода. `popup.css` и `timeline.css` очищены от дублирующихся `:root` и `.hidden`.

### ✅ 3.3. Сузить `host_permissions`

**Статус: DONE**

```diff
- "host_permissions": ["http://*/*", "https://api.groq.com/*", "https://smartspeech.sber.ru/*", "https://ngw.devices.sberbank.ru/*"]
+ "host_permissions": ["https://smartspeech.sber.ru/*", "https://ngw.devices.sberbank.ru/*"]
```

Удалены `http://*/*` (запрос ко всем HTTP-сайтам) и `https://api.groq.com/*` (Groq API больше не используется — заменён на SaluteSpeech). Вставка текста в чат работает через `chrome.scripting.executeScript` с `activeTab` по клику пользователя.

### ✅ 3.4. Удалить дублирующий storage в `background.js`

**Статус: DONE**

```diff
- async function loadData() { ... }   // 7 строк
- async function saveTasks(tasks) { ... }  // 3 строки
+ import { loadState, saveState } from "./shared/storage.js";
```

`background.js` теперь импортирует `loadState` и `saveState` из `shared/storage.js` вместо дублирования логики. Размер файла уменьшился с 205 до 196 строк.

---

## 3. Метрики: до и после

### Размер файлов

| Файл | До | После | Δ |
|------|-----|-------|---|
| timeline.js | 1 052 | удалён | — |
| timeline/app.js | — | 66 | +66 |
| timeline/render.js | — | 275 | +275 |
| timeline/drag-drop.js | — | 184 | +184 |
| timeline/modal.js | — | 197 | +197 |
| timeline/voice.js | — | 265 | +265 |
| timeline/state.js | — | 35 | +35 |
| timeline/date-nav.js | — | 23 | +23 |
| timeline/ui.js | — | 12 | +12 |
| popup.js | 614 | 588 | −26 |
| background.js | 205 | 196 | −9 |
| shared/colors.js | — | 29 | +29 |
| shared/date-utils.js | — | 56 | +56 |
| shared/base.css | — | 26 | +26 |
| timeline.css | 600 | 589 | −11 |
| popup.css | 341 | 321 | −20 |
| **Итого** | **~2 913** | **~2 862** | **−51** |

### Максимальный размер модуля

| Метрика | До | После | Улучшение |
|---------|-----|-------|-----------|
| Макс. файл (строк) | 1 052 (timeline.js) | 275 (render.js) | 3.8× меньше |
| Доменов на файл (макс) | 6 (timeline.js) | 1 (все модули) | 6× меньше |
| DRY-нарушений | 8 функций/переменных | 0 | Полное устранение |

### Дублирование кода

| Сущность | До | После |
|----------|-----|-------|
| `PROJECT_COLORS` | ×2 (popup + timeline) | ×1 (shared/colors.js) |
| `hashStr()` | ×2 | ×1 |
| `projColor()` | ×2 | ×1 |
| `hexRgba()` | ×1 (timeline) | ×1 (shared) |
| `t2m()` | ×2 | ×1 |
| `fmtD()` | ×2 | ×1 |
| `:root` CSS переменные | ×2 (popup.css + timeline.css) | ×1 (shared/base.css) |
| `.hidden` | ×2 | ×1 |
| `loadState`/`saveState` | ×2 (shared + background) | ×1 |

---

## 4. Оставшиеся задачи

### Приоритет 1: ✅ Полностью выполнен

Все 4 задачи P1 выполнены (разбиение god-файла, shared-модули, host_permissions, background storage).

### Приоритет 2: Средний (улучшает поддерживаемость)

#### 3.5. Добавить TypeScript (или JSDoc-валидацию)

**Статус: TODO**

Первоначальный шаг — добавить `tsconfig.json` с `"allowJs": true` и `"checkJs": true`. Второй шаг — начать переводить файлы на `.ts` по одному, начиная с `shared/`.

**Кандидаты для перевода (от простого к сложному):**
1. `shared/colors.js` → `.ts` (чистые функции, нет зависимостей от DOM)
2. `shared/date-utils.js` → `.ts` (чистые функции + константы)
3. `shared/storage.js` → `.ts` (зависимость от `chrome.storage`)
4. `shared/message-builder.js` → `.ts`
5. `timeline/state.js` → `.ts` (типизация объекта `tl`)

#### 3.6. Добавить ESLint + Prettier

**Статус: TODO**

```json
{
  "extends": ["eslint:recommended"],
  "env": { "browser": true, "es2022": true, "webextensions": true },
  "parserOptions": { "ecmaVersion": 2022, "sourceType": "module" }
}
```

#### 3.7. Вынести SVG-иконки

**Статус: TODO**

SVG-иконки микрофона (IDLE, REC, WAIT) и настроек остаются строковыми литералами в `timeline/voice.js`. Варианты:
- A: HTML-файл с `<template>` элементами
- B: Отдельный JS-модуль с DOM-рендерами
- C: SVG-sprite (при появлении бандлера)

#### 3.8. Инкапсулировать состояние

**Статус: DONE (частично)**

Объект `tl` в `timeline/state.js` уже инкапсулирует все mutable-переменные. Осталось:
- Добавить getter `dateStr()` прямо в объект `tl`
- Рассмотреть WeakMap для приватных данных модулей

### Приоритет 3: Низкий (для долгосрочного развития)

#### 3.9. Добавить бандлер (Vite)

**Статус: TODO**

#### 3.10. Добавить базовые тесты

**Статус: TODO**

Кандидаты для unit-тестов (чистые функции в `shared/`):
- `hashStr()`, `projColor()` из `shared/colors.js`
- `fmtD()`, `t2m()`, `m2t()`, `slot2time()` из `shared/date-utils.js`
- `buildTaskMessage()` из `shared/message-builder.js`

#### 3.11. Очистка модели данных

**Статус: TODO**

- Удалить `doneAt: undefined` вместо установки `undefined` при возврате из done
- Ограничить допустимые переходы статусов
- Добавить version-поле в storage для миграций

---

## 5. Историческая справка — исходные проблемы

### 2.1. God-файл `timeline.js` — 1 052 строки ✅ ИСПРАВЛЕНО

### 2.2. Дублирование кода popup.js / timeline.js ✅ ИСПРАВЛЕНО

### 2.3. `background.js` дублирует storage ✅ ИСПРАВЛЕНО

### 2.4. Дублирование CSS ✅ ИСПРАВЛЕНО

### 2.5. Широкие `host_permissions` ✅ ИСПРАВЛЕНО

### 2.6. Отсутствие сборки и форматирования — статус: TODO

### 2.7. Глобальное мутабельное состояние ✅ ЧАСТИЧНО (объект `tl`)

### 2.8. Инлайн SVG в JS — статус: TODO

### 2.9. `pasteInjectFn` в `background.js` — статус: TODO (113 строк, не критично)

### 2.10. Ошибки в модели данных — статус: TODO

---

## 6. Что НЕ рекомендуется делать

1. **Не вводить React/Vue/Svelte** — для расширения такого размера это избыточно. Vanilla JS с ES-модулями вполне достаточен.
2. **Не переписывать всё за один коммит** — incremental refactoring по одному модулю за раз.
3. **Не удалять `pasteInjectFn` из background.js** — она должна оставаться для сериализации через `chrome.scripting.executeScript`. Можно вынести в отдельный файл и импортировать.
4. **Не менять структуру `chrome.storage.local` без миграции** — данные пользователей хранятся там, и сломать формат — значит потерять задачи.
