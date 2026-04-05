# prjcap — Анализ архитектуры и рекомендации по рефакторингу

**Дата:** 2026-04-05  
**Версия:** 1.0.0 (commit 859f542)  
**Объём:** ~3 000 строк (JS: 1 826, CSS: 932, HTML: 177, JSON: 28)

---

## 1. Текущая структура проекта

```
extension/
├── manifest.json              (28 строк)    — MV3 манифест
├── background.js              (205 строк)   — Service Worker
├── popup.html + popup.js + popup.css         — Popup (управление задачами)
├── timeline.html + timeline.js + timeline.css — Полностраничный таймлайн
├── shared/
│   ├── storage.js             (34 строки)   — chrome.storage обёртка
│   └── message-builder.js     (17 строк)    — Сборка промпта
└── icon{16,32,48,128}.png
```

### Архитектурная схема (as-is)

```
┌─────────────┐     messages      ┌──────────────────┐
│   popup.js  │ ◄──────────────► │   background.js  │
│  (popup UI) │                   │ (service worker) │
└──────┬──────┘                   └────────┬─────────┘
       │                                   │ chrome.storage.local
       │                                   │
┌──────┴──────────────────────────────────┐│
│           timeline.js                   ││
│  ┌─────────────────────────────────┐    ││
│  │ Рендеринг карточек              │    ││
│  │ DnD (sidebar↔timeline↔дни)     │    ││
│  │ Modal CRUD                     │    ││
│  │ Голосовой ввод (SaluteSpeech)  │    ││
│  │ Аудио-конвертация (WebM→WAV)   │    ││
│  │ Toast-уведомления              │    ││
│  │ Клавиатурные хоткеи            │    ││
│  └─────────────────────────────────┘    ││
└─────────────────────────────────────────┘│
                                            ▼
                                    chrome.storage.local
```

---

## 2. Выявленные проблемы

### 2.1. God-файл: `timeline.js` — 1 052 строки

Это самая критичная проблема. Один файл содержит шесть разнородных доменов логики, которые слабо связаны между собой:

| Домен | Примерные строки | Что делает |
|-------|-------------------|------------|
| Рендеринг таймлайна | 76–380 | `renderCards`, `layoutColumns`, `renderUnscheduled`, `updateNowLine` |
| Drag & Drop | 525–702 | `setupTimelineDrop`, `setupSidebarDrop`, `setupDayDrop`, `onCardDragStart` |
| Modal CRUD | 401–523 | `openModal`, `saveModal`, `deleteModal` |
| Голосовой ввод | 704–978 | `startRecording`, `stopRecording`, `transcribeWithSber`, `webmToWavBlob`, `getSberAccessToken` |
| Навигация | 382–399 | `navDate`, `goToday`, `onFilterChange` |
| UI-утилиты | 985–1052 | `toast`, `onStorageChange`, `init`, хоткеи |

**Следствия:** при любом изменении (например, починить баг DnD) разработчик вынужден читать весь файл целиком. Сложно тестировать отдельные части.

### 2.2. Дублирование кода между `popup.js` и `timeline.js`

Некоторые функции скопированы практически один-в-один:

| Сущность | popup.js | timeline.js |
|----------|----------|-------------|
| `PROJECT_COLORS` | строки 4–7 | строки 14–17 |
| `hashStr()` | строки 58–62 | строки 61–65 |
| `projColor()` | строки 64–66 | строки 66–68 |
| `t2m()` | строки 52–56 | строки 50–54 |

Это нарушение DRY. Если изменить палитру цветов или логику хеширования — нужно не забыть обновить оба файла.

### 2.3. `background.js` дублирует логику хранения

```js
// background.js — своя реализация
async function loadData() {
  const d = await chrome.storage.local.get(["projects", "tasks"]);
  return { projects: ..., tasks: ... };
}
async function saveTasks(tasks) {
  await chrome.storage.local.set({ tasks });
}
```

При этом в проекте уже есть `shared/storage.js` с `loadState()` и `saveState()`. Причина, по которой background.js не может использовать ES-модули из `shared/` — он работает как Service Worker, но `manifest.json` уже указывает `"type": "module"`, так что импорт возможен.

### 2.4. Дублирование CSS

Оба файла стилей (`popup.css` 332 строки и `timeline.css` 600 строк) независимо определяют одни и те же сущности:

- `:root` с переменными (`--bg`, `--panel`, `--border`, `--text`, `--muted`, `--accent`, `--danger`, `--ok`)
- Класс `.btn` с вариантами `.primary`, `.danger`
- Класс `.toast` с анимациями
- Класс `.ctl` для форм-элементов

При смене цветовой схемы потребуется менять оба файла.

### 2.5. Широкие `host_permissions`

```json
"host_permissions": ["http://*/*", "https://api.groq.com/*", ...]
```

`http://*/*` — это запрос ко всем HTTP-сайтам. Chrome Web Store может отклонить расширение с таким разрешением. Для функционала нужно только:

```json
"host_permissions": [
  "https://smartspeech.sber.ru/*",
  "https://ngw.devices.sberbank.ru/*"
]
```

Вставка текста в чат выполняется через `chrome.scripting.executeScript`, который работает с `activeTab` (срабатывает по клику пользователя).

### 2.6. Отсутствие сборки и форматирования

- Нет бандлера (Webpack, Vite, Rollup) — каждый файл загружается отдельно, нет tree-shaking
- Нет TypeScript — только JSDoc-комментарии для типизации (`@typedef`)
- Нет линтера (ESLint) и форматтера (Prettier) — код стилизован вручную, разные отступы
- Нет тестов вообще

### 2.7. Глобальное мутабельное состояние в `timeline.js`

```js
let curDate = new Date();
let filterPid = "";
let editId = null;
let dragId = null;
let state = { projects: [], tasks: [] };
```

Все эти переменные — глобальные, мутируемые. Любая асинхронная функция может изменить `state`, пока другая функция его читает. Сейчас это не приводит к багам из-за однопоточной природы JS, но делает код хрупким при расширении.

### 2.8. Инлайн SVG как строки в JS

```js
const MIC_IDLE_SVG = '<svg class="mic-icon" viewBox="0 0 24 24" width="14" height="14" ...>';
const MIC_REC_SVG = '<svg ...>';
const MIC_WAIT_SVG = '<svg ...>';
```

Три SVG-иконки живут как многострочные строковые литералы в JS. При изменении иконки приходится редактировать JavaScript. Это ухудшает читаемость и не даёт подсветки синтаксиса SVG.

### 2.9. `pasteInjectFn` в `background.js` — 113 строк

Эта функция внедряется в контекст произвольной веб-страницы через `chrome.scripting.executeScript({ func: pasteInjectFn })`. Это правильный подход (функция сериализуется и теряет связь с модулем), но 113 строк логики поиска и заполнения полей в одном файле с бизнес-логикой — тяжело поддерживать.

### 2.10. Ошибки в модели данных

- `doneAt` устанавливается как `new Date().toISOString()`, но при возврате из done в open — становится `undefined` вместо удаления ключа. Это оставляет «мусор» в объекте задачи.
- Нет валидации данных при чтении из `chrome.storage.local` — если что-то испортилось, расширение молча ломается.
- Статус `'sent'` используется только в popup.js (при отправке в чат), но в timeline.js в `saveModal` можно установить `status: "sent"`, хотя timeline не имеет механизма отправки.

---

## 3. Рекомендации по рефакторингу

### Приоритет 1: Высокий (решает реальные проблемы)

#### 3.1. Разбить `timeline.js` на модули

Предлагаемая структура:

```
extension/
├── timeline/
│   ├── app.js                 — Инициализация, сборка,orchestration (~100 строк)
│   ├── render.js              — renderCards, renderUnscheduled, renderDateLabel, renderFilter (~250 строк)
│   ├── drag-drop.js           — Все DnD-хендлеры (~180 строк)
│   ├── modal.js               — openModal, saveModal, deleteModal, toggleTaskDone (~130 строк)
│   ├── date-nav.js            — curDate, navDate, goToday, fmtDateRu, dowRu (~80 строк)
│   └── voice.js               — Всё связанное с SaluteSpeech (~280 строк)
```

Если есть reluctance к созданию папки `timeline/` — можно расположить файлы как `timeline-*.js` рядом с `timeline.html`. Главное — разбить домены.

**Плюсы:**
- Каждый файл отвечает за одну ответственность (Single Responsibility Principle)
- Легче тестировать отдельные модули
- Merge-конфликты реже затрагивают весь файл

#### 3.2. Вынести общее в `shared/`

```
extension/
├── shared/
│   ├── storage.js             — chrome.storage (уже есть)
│   ├── message-builder.js     — Сборка промпта (уже есть)
│   ├── colors.js              — PROJECT_COLORS, hashStr, projColor, hexRgba
│   ├── date-utils.js          — fmtD, t2m, m2t, slot2time, time2slot, MONTHS_RU, DOW_RU
│   └── styles.css             — :root переменные, .btn, .toast, .ctl
```

**Плюсы:**
- Одно место для изменения палитры
- `popup.js` и `timeline.js` импортируют вместо дублирования
- Единая система дизайн-токенов

#### 3.3. Сузить `host_permissions`

Удалить `http://*/*`. Для `chrome.scripting.executeScript` достаточно добавить `"scripting"` в `permissions` — Chrome автоматически выдаёт доступ к activeTab при действии пользователя.

#### 3.4. Удалить дублирующий доступ к storage в `background.js`

Заменить локальный `loadData()` / `saveTasks()` на импорт из `shared/storage.js`.

---

### Приоритет 2: Средний (улучшает поддерживаемость)

#### 3.5. Добавить TypeScript (или хотя бы JSDoc-валидацию)

Первоначальный шаг — добавить `tsconfig.json` с `"allowJs": true` и `"checkJs": true`. Это даст проверку типов без переписывания файлов. Второй шаг — начать переводить файлы на `.ts` по одному, начиная с `shared/`.

**Плюсы:**
- Автодополнение в IDE
- Поимка ошибок типов до запуска
- Самодокументирующийся код

#### 3.6. Добавить ESLint + Prettier

Минимальная конфигурация:

```json
{
  "extends": ["eslint:recommended"],
  "env": { "browser": true, "es2022": true, "webextensions": true },
  "parserOptions": { "ecmaVersion": 2022, "sourceType": "module" }
}
```

**Плюсы:**
- Единый стиль кода
- Автоматическое обнаружение проблем (unused vars, missing break)
- Pre-commit hook (`husky`) для защиты от неформатированного кода

#### 3.7. Вынести SVG-иконки в отдельный файл или template-строки

Вариант A — HTML-файл с `<template>` элементами, загружаемыми по ID:

```html
<!-- icons.svg.html -->
<template id="icon-mic">
  <svg viewBox="0 0 24 24" ...>...</svg>
</template>
```

Вариант B — отдельный JS-модуль с функциями-рендерами, возвращающими DOM-элементы вместо HTML-строк.

Вариант C — при появлении бандлера — SVG-sprite или inline-svg-loader.

#### 3.8. Инкапсулировать состояние

Заменить набор глобальных `let` переменных на объект-контейнер:

```js
// timeline/date-nav.js
export const dateState = {
  curDate: new Date(),
  filterPid: "",
  get dateStr() { return fmtD(this.curDate); }
};
```

Это не добавит сложности, но сделает очевидным, какие данные относятся к какому модулю.

---

### Приоритет 3: Низкий (для долгосрочного развития)

#### 3.9. Добавить бандлер (Vite)

Для Manifest V3 расширения Vite подходит хорошо — может собирать несколько JS-модулей в один файл (полезно для content script), проводить tree-shaking, минифицировать.

Конфигурация минимальна, но даёт:
- Импорты CSS из JS (`import './styles.css'`)
- Алиасы (`@shared/colors.js`)
- Автоматический перезагруз при разработке (через `vite-plugin-crx`)

#### 3.10. Добавить базовые тесты

Начать с unit-тестов для чистых функций (не зависящих от DOM/chrome API):

- `shared/colors.js` — `hashStr`, `projColor`
- `shared/date-utils.js` — `fmtD`, `t2m`, `m2t`, `slot2time`
- `shared/message-builder.js` — `buildTaskMessage`
- `timeline/voice.js` — `webmToWavBlob` (можно замокать AudioContext)

Инструмент: Vitest (совместим с Vite, быстрый, zero-config).

#### 3.11. Очистка модели данных

- Создать функции-санитайзеры, которые нормализуют задачу при чтении из storage (удаляют `undefined`-поля, проверяют типы)
- Ограничить допустимые переходы статусов: `open → sent → done` и `done → open` (revive). Статус `sent` не должен устанавливаться вручную из timeline.
- Добавить version-поле в storage для будущих миграций схемы

---

## 4. Предлагаемая целевая структура

```
extension/
├── manifest.json
├── background.js                 — Service Worker (упрощённый, импортирует shared)
├── popup/
│   ├── popup.html
│   ├── popup.js                  — Только popup-логика
│   └── popup.css                 — Только popup-стили
├── timeline/
│   ├── timeline.html
│   ├── timeline.js               — Инициализация и сборка модулей
│   ├── render.js                 — Рендеринг карточек, сайдбара, фильтров
│   ├── drag-drop.js              — Все DnD-хендлеры
│   ├── modal.js                  — CRUD-модальное окно
│   ├── date-nav.js               — Навигация по датам
│   ├── voice.js                  — SaluteSpeech: запись, конвертация, распознавание
│   └── timeline.css              — Только timeline-стили
├── shared/
│   ├── storage.js                — chrome.storage обёртка
│   ├── message-builder.js        — Сборка промпта
│   ├── colors.js                 — Палитра и хеш-функции
│   ├── date-utils.js             — Форматирование дат и времени
│   ├── ui-utils.js               — toast, общие DOM-хелперы
│   └── base.css                  — :root, .btn, .toast, .ctl
├── inject/
│   └── paste-inject.js           — Функция внедрения текста (вынос из background.js)
└── icon{16,32,48,128}.png
```

---

## 5. Метрики текущего кода

| Файл | Строки | SLOC (примерно) | Комментарии | Доменов ответственности |
|------|--------|-----------------|-------------|------------------------|
| timeline.js | 1 052 | ~850 | ~50 | 6 |
| popup.js | 517 | ~430 | ~30 | 3 |
| background.js | 205 | ~170 | ~20 | 3 |
| timeline.css | 600 | ~550 | ~10 | 1 |
| popup.css | 332 | ~300 | ~5 | 1 |
| storage.js | 34 | 25 | 8 | 1 |
| message-builder.js | 17 | 10 | 4 | 1 |

**Соотношение код/комментарии:** ~6% — ниже рекомендуемых 15–20%.

---

## 6. Что НЕ рекомендуется делать

1. **Не вводить React/Vue/Svelte** — для расширения такого размера это избыточно. Vanilla JS с модулями вполне достаточен. Фреймворк добавит 100+ KB к размеру расширения и усложнит debug.
2. **Не переписывать всё за один коммит** — incremental refactoring по одному модулю за раз, с тестами на каждом этапе.
3. **Не удалять `pasteInjectFn` из background.js** — она должна оставаться там для сериализации через `chrome.scripting.executeScript`. Но можно вынести в отдельный файл и импортировать.
4. **Не менять структуру `chrome.storage.local` без миграции** — данные пользователей хранятся там, и сломать формат — значит потерять задачи.
