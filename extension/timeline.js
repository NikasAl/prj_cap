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

    // Click to edit
    card.addEventListener("click", () => openModal("edit", null, t.id));

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
  // Defer visual change so browser captures clean drag ghost
  const el = e.target;
  setTimeout(() => el.classList.add("dragging"), 0);

  // Disable pointer-events on ALL task cards so they don't steal dragover/drop
  document.querySelectorAll(".task-card").forEach((c) => { c.style.pointerEvents = "none"; });

  $("btnPrevDay").classList.add("drop-target");
  $("btnNextDay").classList.add("drop-target");
}

function onCardDragEnd(e) {
  dragId = null;
  e.target.classList.remove("dragging");
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
    if (!dragId) return;
    e.preventDefault();
    clearSlotHighlight();

    const slotIndex = getSlotFromY(e.clientY);
    const newTime = slot2time(slotIndex);
    const ds = curDateStr();

    const s = await loadState();
    s.tasks = s.tasks.map((t) =>
      t.id === dragId ? { ...t, scheduledDate: ds, scheduledTime: newTime, duration: t.duration || 1 } : t
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
    if (!dragId) return;
    e.preventDefault();
    panel.classList.remove("sidebar-drag-over");

    const s = await loadState();
    s.tasks = s.tasks.map((t) =>
      t.id === dragId ? { ...t, scheduledDate: undefined, scheduledTime: undefined } : t
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
    if (!dragId) return;
    e.preventDefault();
    btn.classList.remove("drop-hover");

    const s = await loadState();
    const task = s.tasks.find((t) => t.id === dragId);
    if (!task) return;

    const targetDate = new Date(curDateStr() + "T00:00:00");
    targetDate.setDate(targetDate.getDate() + deltaDays);
    const targetDs = fmtD(targetDate);

    // For tasks that had no time, assign 09:00 when moving to another day
    const time = task.scheduledTime || "09:00";

    s.tasks = s.tasks.map((t) =>
      t.id === dragId ? { ...t, scheduledDate: targetDs, scheduledTime: time, duration: t.duration || 1 } : t
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

  buildTimeLabels();
  buildSlotGrid();

  loadAndRender().then(() => scrollToNow());

  setInterval(updateNowLine, 30000);
  chrome.storage.onChanged.addListener(onStorageChange);
}

document.addEventListener("DOMContentLoaded", init);
