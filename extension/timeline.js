/**
 * prjcap — Timeline page logic.
 * Full-day vertical timeline with 15-min slots, drag & drop,
 * task CRUD, project filtering, colour-coded task cards.
 */
import { uid, loadState, saveState } from "./shared/storage.js";

/* ═══════════════════ Constants ═══════════════════ */
const SLOT_H = 48;
const PER_HOUR = 4;
const TOTAL_SLOTS = 24 * PER_HOUR;
const SLOT_MIN = 15;

const PROJECT_COLORS = [
  "#3d8bfd", "#3ecf8e", "#ff9f43", "#ee5a6f", "#a78bfa",
  "#22d3ee", "#f472b6", "#84cc16", "#fbbf24", "#6366f1",
];

/* ═══════════════════ State ═══════════════════ */
let curDate = new Date();
let filterPid = "";
let editId = null;
let dragId = null;
let state = { projects: [], tasks: [] };

/* ═══════════════════ Helpers ═══════════════════ */
const $ = (id) => document.getElementById(id);

function fmtD(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function curDateStr() { return fmtD(curDate); }

const MONTHS_RU = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];
const DOW_RU = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

function fmtDateRu(ds) {
  const [, m, d] = ds.split("-").map(Number);
  return `${d} ${MONTHS_RU[m - 1]}`;
}

function dowRu(ds) {
  return DOW_RU[new Date(ds + "T00:00:00").getDay()];
}

function t2m(t) {
  if (!t) return -1;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}
function m2t(m) {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
function slot2time(s) { return m2t(s * SLOT_MIN); }
function time2slot(t) { return Math.floor(t2m(t) / SLOT_MIN); }

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return h;
}
function projColor(pid) {
  return PROJECT_COLORS[Math.abs(hashStr(pid || "")) % PROJECT_COLORS.length];
}
function hexRgba(hex, a) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

/* ═══════════════════ Rendering ═══════════════════ */

async function loadAndRender() {
  state = await loadState();
  renderDateLabel();
  renderFilter();
  renderCards();
  renderUnscheduled();
  updateNowLine();
}

function renderDateLabel() {
  const ds = curDateStr();
  const isToday = ds === fmtD(new Date());
  const lbl = $(  "dateLabel");
  lbl.innerHTML = `${fmtDateRu(ds)} ${curDate.getFullYear()} <span class="dow">${dowRu(ds)}</span>${isToday ? " — сегодня" : ""}`;
}

function renderFilter() {
  const sel = $("projectFilter");
  const curVal = sel.value;
  sel.innerHTML = '<option value="">Все проекты</option>';
  for (const p of state.projects.sort((a, b) => a.name.localeCompare(b.name))) {
    const o = document.createElement("option");
    o.value = p.id;
    o.textContent = p.name;
    if (p.id === curVal || p.id === filterPid) o.selected = true;
    sel.appendChild(o);
  }
  filterPid = sel.value;
}

/* ── Time labels & slot grid (built once) ── */

function buildTimeLabels() {
  const col = $("timeCol");
  col.style.height = `${TOTAL_SLOTS * SLOT_H}px`;
  for (let h = 0; h < 24; h++) {
    const lbl = document.createElement("div");
    lbl.className = "time-lbl";
    lbl.style.top = `${h * PER_HOUR * SLOT_H}px`;
    lbl.textContent = `${String(h).padStart(2, "0")}:00`;
    col.appendChild(lbl);
  }
}

function buildSlotGrid() {
  const grid = $("slotGrid");
  grid.innerHTML = "";
  for (let i = 0; i < TOTAL_SLOTS; i++) {
    const s = document.createElement("div");
    s.className = "slot";
    s.dataset.slot = i;
    if (i % PER_HOUR === 0) s.classList.add("hour-mark");

    // Double-click to add task at this slot
    s.addEventListener("dblclick", () => openModal("add", i));

    grid.appendChild(s);
  }
}

/* ── Unscheduled tasks (sidebar) ── */

function getUnscheduledTasks() {
  let tasks = state.tasks.filter(
    (t) => t.status !== "done" && (!t.scheduledDate || !t.scheduledTime)
  );
  if (filterPid) tasks = tasks.filter((t) => String(t.projectId) === String(filterPid));
  return tasks.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

function renderUnscheduled() {
  const list = $("unscheduledList");
  const emptyEl = $("unscheduledEmpty");
  const countEl = $("unscheduledCount");
  list.innerHTML = "";

  const tasks = getUnscheduledTasks();
  countEl.textContent = tasks.length > 0 ? tasks.length : "";

  if (tasks.length === 0) {
    emptyEl.classList.remove("hidden");
    return;
  }
  emptyEl.classList.add("hidden");

  for (const t of tasks) {
    const color = projColor(t.projectId);
    const proj = state.projects.find((p) => p.id === t.projectId);

    const card = document.createElement("div");
    card.className = "unscheduled-card";
    card.style.borderLeftColor = color;
    card.draggable = true;
    card.title = t.taskText;

    const pSpan = document.createElement("div");
    pSpan.className = "uc-proj";
    pSpan.textContent = proj ? proj.name : "—";
    pSpan.style.color = color;
    card.appendChild(pSpan);

    const tDiv = document.createElement("div");
    tDiv.className = "uc-text";
    tDiv.textContent = t.taskText;
    card.appendChild(tDiv);

    const hint = document.createElement("div");
    hint.className = "uc-hint";
    hint.textContent = "Перетащите на слот";
    card.appendChild(hint);

    // Drag from sidebar to timeline
    card.addEventListener("dragstart", (e) => onCardDragStart(e, t.id));
    card.addEventListener("dragend", onCardDragEnd);

    // Click to edit
    card.addEventListener("click", (e) => {
      if (!card.classList.contains("dragging")) openModal("edit", null, t.id);
    });

    list.appendChild(card);
  }
}

/* ── Task cards ── */

function getDayTasks() {
  const ds = curDateStr();
  let tasks = state.tasks.filter(
    (t) => t.scheduledDate === ds && t.scheduledTime && t.status !== "done"
  );
  if (filterPid) tasks = tasks.filter((t) => String(t.projectId) === String(filterPid));
  return tasks;
}

function layoutColumns(tasks) {
  if (tasks.length === 0) return [];
  const sorted = [...tasks].sort((a, b) => {
    const sa = time2slot(a.scheduledTime);
    const sb = time2slot(b.scheduledTime);
    if (sa !== sb) return sa - sb;
    return (b.duration || 1) - (a.duration || 1);
  });

  const colEnds = []; // end-minute for each column
  const result = [];

  for (const t of sorted) {
    const start = time2slot(t.scheduledTime);
    const dur = t.duration || 1;
    const end = start + dur;

    let col = -1;
    for (let c = 0; c < colEnds.length; c++) {
      if (start >= colEnds[c]) { col = c; break; }
    }
    if (col === -1) { col = colEnds.length; colEnds.push(0); }
    colEnds[col] = end;
    result.push({ task: t, col });
  }

  const totalCols = colEnds.length;
  for (const r of result) r.total = totalCols;
  return result;
}

function renderCards() {
  const layer = $("taskLayer");
  layer.innerHTML = "";

  const tasks = getDayTasks();
  if (tasks.length === 0) {
    // Show empty state hint
    const es = document.createElement("div");
    es.className = "empty-state";
    es.innerHTML = `<div class="empty-icon">📅</div><p>Нет запланированных задач</p><p style="font-size:12px;margin-top:4px;opacity:.7">Дважды кликните на слот или нажмите «+ Задача»</p>`;
    layer.appendChild(es);
    return;
  }

  const layout = layoutColumns(tasks);

  for (const { task: t, col, total } of layout) {
    const startSlot = time2slot(t.scheduledTime);
    const dur = t.duration || 1;
    const top = startSlot * SLOT_H;
    const height = dur * SLOT_H;
    const color = projColor(t.projectId);
    const proj = state.projects.find((p) => p.id === t.projectId);
    const compact = height < 60;

    const card = document.createElement("div");
    card.className = `task-card${compact ? " card-compact" : ""}`;
    card.style.top = `${top}px`;
    card.style.height = `${height}px`;
    card.style.borderLeftColor = color;
    card.style.background = hexRgba(color, 0.12);

    // Column positioning
    const colW = total > 1 ? `${100 / total}%` : "calc(100% - 8px)";
    card.style.width = colW;
    card.style.left = total > 1 ? `${(col * 100) / total + 0.5}%` : "4px";

    // Project name
    const pSpan = document.createElement("span");
    pSpan.className = "card-proj";
    pSpan.textContent = proj ? proj.name : "—";
    pSpan.style.color = color;
    card.appendChild(pSpan);

    // Task text
    const tDiv = document.createElement("div");
    tDiv.className = "card-text";
    tDiv.textContent = t.taskText;
    card.appendChild(tDiv);

    // Time range
    const tmDiv = document.createElement("div");
    tmDiv.className = "card-time";
    const endSlot = startSlot + dur;
    tmDiv.textContent = `${slot2time(startSlot)} – ${slot2time(endSlot)}`;
    card.appendChild(tmDiv);

    // Click to edit (guard against opening modal right after a drag)
    card.addEventListener("click", () => {
      if (!card.classList.contains("dragging")) openModal("edit", null, t.id);
    });

    // Drag
    card.draggable = true;
    card.addEventListener("dragstart", (e) => onCardDragStart(e, t.id));
    card.addEventListener("dragend", onCardDragEnd);

    layer.appendChild(card);
  }
}

/* ── Current time line ── */

function updateNowLine() {
  const line = $("nowLine");
  const now = new Date();
  const ds = fmtD(now);
  if (ds !== curDateStr()) {
    line.style.display = "none";
    return;
  }
  line.style.display = "";
  const minutes = now.getHours() * 60 + now.getMinutes();
  const top = (minutes / SLOT_MIN) * SLOT_H;
  line.style.top = `${top}px`;
}

function scrollToNow() {
  const scroll = $("timelineScroll");
  const now = new Date();
  const ds = fmtD(now);
  let targetSlot;
  if (ds === curDateStr()) {
    targetSlot = time2slot(`${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`);
  } else {
    targetSlot = 8 * PER_HOUR; // 8:00
  }
  const targetTop = targetSlot * SLOT_H;
  const visible = scroll.clientHeight;
  scroll.scrollTop = Math.max(0, targetTop - visible * 0.3);
}

/* ═══════════════════ Navigation ═══════════════════ */

function navDate(delta) {
  curDate.setDate(curDate.getDate() + delta);
  loadAndRender();
}

function goToday() {
  curDate = new Date();
  loadAndRender();
  scrollToNow();
}

function onFilterChange() {
  filterPid = $("projectFilter").value;
  renderCards();
  renderUnscheduled();
}

/* ═══════════════════ Modal ═══════════════════ */

function openModal(mode, slotIndex = null, taskId = null) {
  editId = mode === "edit" ? taskId : null;
  const overlay = $("modalOverlay");
  const title = $("modalTitle");

  // Populate project selector
  const pSel = $("mProject");
  pSel.innerHTML = "";
  if (state.projects.length === 0) {
    pSel.innerHTML = '<option value="">— нет проектов —</option>';
  } else {
    for (const p of state.projects.sort((a, b) => a.name.localeCompare(b.name))) {
      const o = document.createElement("option");
      o.value = p.id;
      o.textContent = p.name;
      pSel.appendChild(o);
    }
  }

  if (mode === "edit" && taskId) {
    title.textContent = "Редактировать задачу";
    const t = state.tasks.find((x) => x.id === taskId);
    if (!t) return;
    pSel.value = t.projectId;
    $("mText").value = t.taskText;
    $("mDate").value = t.scheduledDate || curDateStr();
    $("mTime").value = t.scheduledTime || slot2time(slotIndex || 0);
    $("mDuration").value = String(t.duration || 1);
    $("btnMDelete").classList.remove("hidden");
  } else {
    title.textContent = "Новая задача";
    pSel.value = filterPid || (state.projects[0] ? state.projects[0].id : "");
    $("mText").value = "";
    $("mDate").value = curDateStr();
    $("mTime").value = slotIndex != null ? slot2time(slotIndex) : "09:00";
    $("mDuration").value = "1";
    $("btnMDelete").classList.add("hidden");
  }

  overlay.classList.remove("hidden");
  $("mText").focus();
}

function closeModal() {
  cleanupRecording();
  $("modalOverlay").classList.add("hidden");
  editId = null;
}

async function saveModal() {
  const pid = $("mProject").value;
  const text = $("mText").value.trim();
  const date = $("mDate").value;
  const time = $("mTime").value;
  const dur = parseInt($("mDuration").value, 10);

  if (!pid) { toast("Выберите проект", "err"); return; }
  if (!text) { toast("Введите текст задачи", "err"); return; }
  if (!date) { toast("Укажите дату", "err"); return; }
  if (!time) { toast("Укажите время", "err"); return; }

  const s = await loadState();

  if (editId) {
    s.tasks = s.tasks.map((t) =>
      t.id === editId
        ? { ...t, projectId: pid, taskText: text, scheduledDate: date, scheduledTime: time, duration: dur }
        : t
    );
    toast("Задача обновлена", "ok");
  } else {
    const task = {
      id: uid(),
      projectId: pid,
      taskText: text,
      status: "open",
      createdAt: new Date().toISOString(),
      scheduledDate: date,
      scheduledTime: time,
      duration: dur,
    };
    s.tasks.push(task);
    toast("Задача создана", "ok");
  }

  await saveState({ tasks: s.tasks });
  state = s;
  closeModal();

  // If task date matches current view, re-render
  if (date === curDateStr()) {
    renderCards();
  } else {
    curDate = new Date(date + "T00:00:00");
    loadAndRender();
    scrollToNow();
  }
}

async function deleteModal() {
  if (!editId) return;
  const t = state.tasks.find((x) => x.id === editId);
  if (!t) return;
  if (!confirm(`Удалить задачу «${t.taskText.slice(0, 60)}»?`)) return;

  const s = await loadState();
  s.tasks = s.tasks.filter((x) => x.id !== editId);
  await saveState({ tasks: s.tasks });
  state = s;
  closeModal();
  renderCards();
  renderUnscheduled();
  toast("Задача удалена", "ok");
}

/* ═══════════════════ Drag & Drop ═══════════════════ */

function onCardDragStart(e, taskId) {
  dragId = taskId;
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", taskId);
  // Find the actual card element (e.target may be a child span/div)
  const card = e.target.closest(".task-card, .unscheduled-card");
  // Defer visual change so browser captures clean drag ghost
  if (card) setTimeout(() => card.classList.add("dragging"), 0);

  // Disable pointer-events on task cards so they don't steal dragover/drop.
  // IMPORTANT: do NOT disable on the drag source itself — browsers cancel the
  // drag if the source element loses pointer-events while inside a
  // pointer-events:none container (taskLayer).
  document.querySelectorAll(".task-card").forEach((c) => {
    if (c !== card) c.style.pointerEvents = "none";
  });

  $("btnPrevDay").classList.add("drop-target");
  $("btnNextDay").classList.add("drop-target");
}

function onCardDragEnd(e) {
  // dragId may already be null if consumed by a drop handler — that's fine
  dragId = null;
  // Find the actual card element (e.target may be a child span/div)
  const card = e.target.closest(".task-card, .unscheduled-card");
  if (card) card.classList.remove("dragging");
  // Restore pointer-events on task cards
  document.querySelectorAll(".task-card").forEach((c) => { c.style.pointerEvents = ""; });
  $("btnPrevDay").classList.remove("drop-target", "drop-hover");
  $("btnNextDay").classList.remove("drop-target", "drop-hover");
  clearSlotHighlight();
  $("unscheduledPanel").classList.remove("sidebar-drag-over");
}

function getSlotFromY(clientY) {
  const grid = $("slotGrid");
  const rect = grid.getBoundingClientRect();
  const y = clientY - rect.top;
  return Math.max(0, Math.min(TOTAL_SLOTS - 1, Math.floor(y / SLOT_H)));
}

function highlightSlot(index) {
  clearSlotHighlight();
  const slots = $("slotGrid").children;
  if (slots[index]) slots[index].classList.add("drag-over");
}

function clearSlotHighlight() {
  document.querySelectorAll(".slot.drag-over").forEach((s) => s.classList.remove("drag-over"));
}

/** Attach drop handlers to bodyCol (parent of both slots and task cards) */
function setupTimelineDrop() {
  const bodyCol = $("bodyCol");

  bodyCol.addEventListener("dragover", (e) => {
    if (!dragId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    highlightSlot(getSlotFromY(e.clientY));
  });

  bodyCol.addEventListener("dragleave", (e) => {
    // Only clear if leaving bodyCol entirely (not into a child)
    if (!bodyCol.contains(e.relatedTarget)) {
      clearSlotHighlight();
    }
  });

  bodyCol.addEventListener("drop", async (e) => {
    // Capture dragId immediately BEFORE any await — dragend fires during
    // the first await and resets the global dragId to null otherwise.
    const taskId = dragId;
    if (!taskId) return;
    dragId = null;

    e.preventDefault();
    clearSlotHighlight();

    const slotIndex = getSlotFromY(e.clientY);
    const newTime = slot2time(slotIndex);
    const ds = curDateStr();

    const s = await loadState();
    s.tasks = s.tasks.map((t) =>
      t.id === taskId ? { ...t, scheduledDate: ds, scheduledTime: newTime, duration: t.duration || 1 } : t
    );
    await saveState({ tasks: s.tasks });
    state = s;
    renderCards();
    renderUnscheduled();
    toast("Задача перемещена", "ok");
  });
}

/** Drop on sidebar unscheduled panel — removes schedule from a task */
function setupSidebarDrop() {
  const panel = $("unscheduledPanel");

  panel.addEventListener("dragover", (e) => {
    if (!dragId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    panel.classList.add("sidebar-drag-over");
  });

  panel.addEventListener("dragleave", (e) => {
    if (!panel.contains(e.relatedTarget)) {
      panel.classList.remove("sidebar-drag-over");
    }
  });

  panel.addEventListener("drop", async (e) => {
    // Capture dragId immediately BEFORE any await
    const taskId = dragId;
    if (!taskId) return;
    dragId = null;

    e.preventDefault();
    panel.classList.remove("sidebar-drag-over");

    const s = await loadState();
    s.tasks = s.tasks.map((t) =>
      t.id === taskId ? { ...t, scheduledDate: undefined, scheduledTime: undefined } : t
    );
    await saveState({ tasks: s.tasks });
    state = s;
    renderCards();
    renderUnscheduled();
    toast("Задача убрана из расписания", "ok");
  });
}

/* Day drop (prev / next) */
function setupDayDrop(btn, deltaDays) {
  btn.addEventListener("dragover", (e) => {
    if (!dragId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    btn.classList.add("drop-hover");
  });
  btn.addEventListener("dragleave", () => btn.classList.remove("drop-hover"));
  btn.addEventListener("drop", async (e) => {
    // Capture dragId immediately BEFORE any await
    const taskId = dragId;
    if (!taskId) return;
    dragId = null;

    e.preventDefault();
    btn.classList.remove("drop-hover");

    const s = await loadState();
    const task = s.tasks.find((t) => t.id === taskId);
    if (!task) return;

    const targetDate = new Date(curDateStr() + "T00:00:00");
    targetDate.setDate(targetDate.getDate() + deltaDays);
    const targetDs = fmtD(targetDate);

    // For tasks that had no time, assign 09:00 when moving to another day
    const time = task.scheduledTime || "09:00";

    s.tasks = s.tasks.map((t) =>
      t.id === taskId ? { ...t, scheduledDate: targetDs, scheduledTime: time, duration: t.duration || 1 } : t
    );
    await saveState({ tasks: s.tasks });

    // Navigate to that day
    curDate = targetDate;
    state = s;
    loadAndRender();
    scrollToNow();
    toast("Задача перенесена", "ok");
  });
}

/* ═══════════════════ Voice dictation (MediaRecorder + SaluteSpeech) ═══════════════════ */

let mediaRecorder = null;
let audioChunks = [];
let micStream = null;
let isRecording = false;
let recordTimer = null;
let recordSeconds = 0;

const SBER_TOKEN_URL = "https://ngw.devices.sberbank.ru:9443/api/v2/oauth";
const SBER_RECOGNIZE_URL = "https://smartspeech.sber.ru/rest/v1/speech:recognize";

/** Detect MediaRecorder support */
function initVoiceInput() {
  const btn = $("btnMic");
  const btnSettings = $("btnMicSettings");
  if (!window.MediaRecorder || !navigator.mediaDevices?.getUserMedia) {
    btn.classList.add("hidden");
    if (btnSettings) btnSettings.classList.add("hidden");
    return;
  }
  btn.addEventListener("click", () => {
    if (isRecording) stopRecording();
    else startRecording();
  });
  if (btnSettings) {
    btnSettings.addEventListener("click", (e) => {
      e.stopPropagation();
      promptSberCredentials();
    });
  }
}

async function getSberCredentials() {
  const d = await chrome.storage.local.get(["sberClientId", "sberClientSecret"]);
  return { clientId: d.sberClientId || "", clientSecret: d.sberClientSecret || "" };
}

async function promptSberCredentials() {
  const creds = await getSberCredentials();
  const clientId = prompt(
    "Client ID ( studio.sber.ru → проект SaluteSpeech → Авторизационные данные ):",
    creds.clientId || ""
  );
  if (clientId === null) return;
  if (!clientId.trim()) {
    await chrome.storage.local.remove(["sberClientId", "sberClientSecret"]);
    toast("Данные Сбера удалены", "ok");
    return;
  }
  const clientSecret = prompt("Client Secret:", creds.clientSecret || "");
  if (clientSecret === null) return;
  await chrome.storage.local.set({ sberClientId: clientId.trim(), sberClientSecret: clientSecret.trim() });
  toast("Данные Сбера сохранены", "ok");
}

/** Obtain a SaluteSpeech access token (valid 30 min) */
async function getSberAccessToken(clientId, clientSecret) {
  const basicAuth = btoa(`${clientId}:${clientSecret}`);
  const resp = await fetch(`${SBER_TOKEN_URL}?scope=SALUTE_SPEECH_PERS`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json",
      "Authorization": `Basic ${basicAuth}`,
      "RqUID": crypto.randomUUID(),
    },
  });
  if (!resp.ok) {
    throw new Error(`Token request failed: ${resp.status}`);
  }
  const data = await resp.json();
  return data.access_token;
}

/** Convert WebM/Opus to WAV 16kHz mono PCM (SaluteSpeech requirement) */
function webmToWavBlob(webmBlob) {
  return new Promise((resolve) => {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    const reader = new FileReader();
    reader.onload = async () => {
      const audioBuffer = await audioCtx.decodeAudioData(reader.result);
      // Take first channel only, resample to 16kHz
      const offlineCtx = new OfflineAudioContext(1, audioBuffer.duration * 16000, 16000);
      const source = offlineCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(offlineCtx.destination);
      source.start();
      const renderedBuffer = await offlineCtx.startRendering();
      const pcm = renderedBuffer.getChannelData(0);
      // Encode as WAV
      const wavBuf = new ArrayBuffer(44 + pcm.length * 2);
      const view = new DataView(wavBuf);
      const writeStr = (offset, str) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); };
      writeStr(0, "RIFF");
      view.setUint32(4, 36 + pcm.length * 2, true);
      writeStr(8, "WAVE");
      writeStr(12, "fmt ");
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true); // PCM
      view.setUint16(22, 1, true); // mono
      view.setUint32(24, 16000, true);
      view.setUint32(28, 32000, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      writeStr(36, "data");
      view.setUint32(40, pcm.length * 2, true);
      for (let i = 0; i < pcm.length; i++) {
        const s = Math.max(-1, Math.min(1, pcm[i]));
        view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      }
      resolve(new Blob([wavBuf], { type: "audio/wav" }));
    };
    reader.readAsArrayBuffer(webmBlob);
  });
}

async function startRecording() {
  const creds = await getSberCredentials();
  if (!creds.clientId || !creds.clientSecret) {
    toast("Нужны данные Сбера. Нажмите ⚙️ рядом с микрофоном.", "err");
    return;
  }

  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    console.log("[prjcap voice] mic stream acquired");
  } catch (err) {
    console.warn("[prjcap voice] getUserMedia failed:", err);
    toast("Не удалось получить доступ к микрофону", "err");
    return;
  }

  audioChunks = [];

  const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
    ? "audio/webm;codecs=opus"
    : "audio/webm";

  mediaRecorder = new MediaRecorder(micStream, { mimeType });

  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) audioChunks.push(e.data);
  };

  mediaRecorder.onstop = async () => {
    if (micStream) {
      micStream.getTracks().forEach((t) => t.stop());
      micStream = null;
    }
    clearInterval(recordTimer);

    if (audioChunks.length === 0) {
      toast("Аудио не записано", "err");
      return;
    }

    const rawBlob = new Blob(audioChunks, { type: mimeType });
    console.log("[prjcap voice] recorded raw:", rawBlob.size, "bytes");
    await transcribeWithSber(rawBlob);
  };

  mediaRecorder.start(250);
  isRecording = true;
  recordSeconds = 0;
  $("btnMic").classList.add("recording");
  $("btnMic").textContent = "⏹";

  recordTimer = setInterval(() => {
    recordSeconds++;
    const m = String(Math.floor(recordSeconds / 60)).padStart(2, "0");
    const s = String(recordSeconds % 60).padStart(2, "0");
    $("btnMic").textContent = `⏹ ${m}:${s}`;
  }, 1000);
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
  }
  isRecording = false;
  $("btnMic").classList.remove("recording");
  $("btnMic").textContent = "🎤";
  clearInterval(recordTimer);
}

async function transcribeWithSber(audioBlob) {
  const creds = await getSberCredentials();
  if (!creds.clientId || !creds.clientSecret) {
    toast("Данные Сбера не настроены", "err");
    return;
  }

  $("btnMic").textContent = "⏳";
  toast("Подготавливаю аудио…", "ok");

  try {
    // Convert to WAV 16kHz mono
    const wavBlob = await webmToWavBlob(audioBlob);
    console.log("[prjcap voice] converted WAV:", wavBlob.size, "bytes");

    // Limit to 2 MB and 60 seconds — SaluteSpeech constraints
    if (wavBlob.size > 2 * 1024 * 1024) {
      toast("Аудио слишком длинное (макс 1 минута)", "err");
      $("btnMic").textContent = "🎤";
      return;
    }

    toast("Распознаю речь…", "ok");

    // Get access token
    let accessToken;
    try {
      accessToken = await getSberAccessToken(creds.clientId, creds.clientSecret);
      console.log("[prjcap voice] token acquired");
    } catch (err) {
      console.warn("[prjcap voice] token error:", err);
      toast("Ошибка авторизации Сбера. Проверьте Client ID/Secret.", "err");
      $("btnMic").textContent = "🎤";
      return;
    }

    // Recognize speech
    const resp = await fetch(`${SBER_RECOGNIZE_URL}?language=ru-RU&sample_rate=16000`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "audio/wav",
      },
      body: wavBlob,
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.warn("[prjcap voice] recognize error:", resp.status, errText);
      if (resp.status === 401) {
        toast("Токен отклонён. Проверьте данные Сбера (⚙️).", "err");
      } else {
        toast(`Ошибка распознавания: ${resp.status}`, "err");
      }
      $("btnMic").textContent = "🎤";
      return;
    }

    const data = await resp.json();
    console.log("[prjcap voice] recognition result:", JSON.stringify(data));

    const text = (data.result || []).join(" ");
    if (text.trim()) {
      const ta = $("mText");
      const base = ta.value.trim();
      ta.value = base ? `${base} ${text.trim()}` : text.trim();
      ta.scrollTop = ta.scrollHeight;
      toast("Голос распознан", "ok");
    } else {
      toast("Речь не распознана. Попробуйте ещё раз.", "err");
    }
  } catch (err) {
    console.warn("[prjcap voice] error:", err);
    toast("Ошибка при распознавании: " + err.message, "err");
  } finally {
    $("btnMic").textContent = "🎤";
  }
}

/** Stop recording if active when modal closes */
function cleanupRecording() {
  stopRecording();
}

/* ═══════════════════ Toast ═══════════════════ */

let toastTimer = null;
function toast(msg, kind = "ok") {
  const el = $("toast");
  el.textContent = msg;
  el.className = `toast ${kind} visible`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.className = "toast hidden", 2200);
}

/* ═══════════════════ Storage sync ═══════════════════ */

function onStorageChange(changes) {
  if (changes.projects || changes.tasks) {
    loadAndRender();
  }
}

/* ═══════════════════ Init ═══════════════════ */

function init() {
  // Event listeners
  $("btnPrevDay").addEventListener("click", () => navDate(-1));
  $("btnNextDay").addEventListener("click", () => navDate(1));
  $("btnToday").addEventListener("click", goToday);
  $("projectFilter").addEventListener("change", onFilterChange);
  $("btnAddTask").addEventListener("click", () => openModal("add"));
  $("btnMSave").addEventListener("click", saveModal);
  $("btnMDelete").addEventListener("click", deleteModal);
  $("btnMCancel").addEventListener("click", closeModal);
  $("modalOverlay").addEventListener("click", (e) => {
    if (e.target === $("modalOverlay")) closeModal();
  });

  // Keyboard shortcuts
  document.addEventListener("keydown", (e) => {
    if ($("modalOverlay").classList.contains("hidden")) {
      if (e.key === "ArrowLeft") navDate(-1);
      if (e.key === "ArrowRight") navDate(1);
      if (e.key === "t" || e.key === "T" || e.key === "з" || e.key === "З") goToday();
    } else {
      if (e.key === "Escape") closeModal();
    }
  });

  setupTimelineDrop();
  setupSidebarDrop();
  setupDayDrop($("btnPrevDay"), -1);
  setupDayDrop($("btnNextDay"), 1);

  initVoiceInput();
  buildTimeLabels();
  buildSlotGrid();

  loadAndRender().then(() => scrollToNow());

  setInterval(updateNowLine, 30000);
  chrome.storage.onChanged.addListener(onStorageChange);
}

document.addEventListener("DOMContentLoaded", init);
