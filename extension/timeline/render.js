/**
 * Timeline rendering — cards, sidebar, time grid, now-line, filters.
 * Does NOT import drag-drop or modal to avoid circular dependencies.
 * Uses data-task-id attributes; event delegation is handled by drag-drop.js and modal.js.
 */
import { SLOT_H, PER_HOUR, TOTAL_SLOTS, SLOT_MIN, fmtD, fmtDateRu, dowRu, slot2time, time2slot } from "../shared/date-utils.js";
import { projColor, hexRgba } from "../shared/colors.js";
import { tl, reload, dateStr } from "./state.js";

const $ = (id) => document.getElementById(id);

/** Get project color, preferring saved color */
function pColor(projectId) {
  const p = tl.projects.find((x) => x.id === projectId);
  return projColor(projectId, p && p.color ? p.color : null);
}

/* ── Main orchestrator ── */

export async function loadAndRender() {
  await reload();
  renderDateLabel();
  renderFilter();
  renderCards();
  renderUnscheduled();
  updateNowLine();
}

/* ── Date label ── */

export function renderDateLabel() {
  const ds = dateStr();
  const isToday = ds === fmtD(new Date());
  const lbl = $("dateLabel");
  lbl.innerHTML = `${fmtDateRu(ds)} ${tl.curDate.getFullYear()} <span class="dow">${dowRu(ds)}</span>${isToday ? " — сегодня" : ""}`;
}

/* ── Project filter ── */

export function renderFilter() {
  const sel = $("projectFilter");
  const curVal = sel.value;
  sel.innerHTML = '<option value="">Все проекты</option>';
  for (const p of tl.projects.sort((a, b) => a.name.localeCompare(b.name))) {
    const o = document.createElement("option");
    o.value = p.id;
    o.textContent = p.name;
    if (p.id === curVal || p.id === tl.filterPid) o.selected = true;
    sel.appendChild(o);
  }
  tl.filterPid = sel.value;
}

/* ── Time labels & slot grid (built once) ── */

export function buildTimeLabels() {
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

export function buildSlotGrid() {
  const grid = $("slotGrid");
  grid.innerHTML = "";
  for (let i = 0; i < TOTAL_SLOTS; i++) {
    const s = document.createElement("div");
    s.className = "slot";
    s.dataset.slot = i;
    if (i % PER_HOUR === 0) s.classList.add("hour-mark");
    s.addEventListener("dblclick", () => {
      // Dispatch custom event so modal.js can handle it without circular import
      document.dispatchEvent(new CustomEvent("tl:openModal", { detail: { mode: "add", slotIndex: i } }));
    });
    grid.appendChild(s);
  }
}

/* ── Unscheduled tasks (sidebar) ── */

function getUnscheduledTasks() {
  let tasks = tl.tasks.filter(
    (t) => t.status !== "done" && (!t.scheduledDate || !t.scheduledTime)
  );
  if (tl.filterPid) tasks = tasks.filter((t) => String(t.projectId) === String(tl.filterPid));
  return tasks.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function renderUnscheduled() {
  const list = $("unscheduledList");
  const emptyEl = $("unscheduledEmpty");
  const countEl = $("unscheduledCount");
  list.innerHTML = "";

  const tasks = getUnscheduledTasks();
  countEl.textContent = tasks.length > 0 ? tasks.length : "";

  if (tasks.length === 0) { emptyEl.classList.remove("hidden"); return; }
  emptyEl.classList.add("hidden");

  for (const t of tasks) {
    const color = pColor(t.projectId);
    const proj = tl.projects.find((p) => p.id === t.projectId);

    const card = document.createElement("div");
    card.className = "unscheduled-card";
    card.style.borderLeftColor = color;
    card.draggable = true;
    card.dataset.taskId = t.id;
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

    list.appendChild(card);
  }
}

/* ── Task cards ── */

function getDayTasks() {
  const ds = dateStr();
  let tasks = tl.tasks.filter(
    (t) => t.scheduledDate === ds && t.scheduledTime
  );
  if (tl.filterPid) tasks = tasks.filter((t) => String(t.projectId) === String(tl.filterPid));
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

  const colEnds = [];
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

export function renderCards() {
  const layer = $("taskLayer");
  layer.innerHTML = "";

  const tasks = getDayTasks();
  if (tasks.length === 0) {
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
    const color = pColor(t.projectId);
    const proj = tl.projects.find((p) => p.id === t.projectId);
    const compact = height < 60;

    const card = document.createElement("div");
    card.className = `task-card${compact ? " card-compact" : ""}${t.status === "done" ? " card-done" : ""}`;
    card.style.top = `${top}px`;
    card.style.height = `${height}px`;
    card.style.borderLeftColor = color;
    card.style.background = hexRgba(color, 0.12);
    card.dataset.taskId = t.id;
    card.draggable = true;

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

    // Status check/badge
    if (t.status === "done") {
      const badge = document.createElement("span");
      badge.className = "card-badge card-badge-done";
      badge.textContent = "✓";
      card.appendChild(badge);
    } else {
      const chk = document.createElement("button");
      chk.type = "button";
      chk.className = "card-done-btn";
      chk.title = "Отметить выполненной";
      chk.textContent = "✓ Сделано";
      card.appendChild(chk);

      // Chat & copy action buttons (only for open/sent tasks)
      if (!compact) {
        const actWrap = document.createElement("div");
        actWrap.className = "card-actions";

        // Open chat button
        const chatBtn = document.createElement("button");
        chatBtn.type = "button";
        chatBtn.className = "card-act-btn card-act-chat";
        chatBtn.title = "Открыть чат с агентом";
        chatBtn.innerHTML = "&#128172;";
        chatBtn.dataset.projectId = t.projectId;
        chatBtn.dataset.taskId = t.id;
        actWrap.appendChild(chatBtn);

        // Copy prompt button
        const copyBtn = document.createElement("button");
        copyBtn.type = "button";
        copyBtn.className = "card-act-btn card-act-copy";
        copyBtn.title = "Копировать промпт задачи";
        copyBtn.innerHTML = "&#128203;";
        copyBtn.dataset.taskId = t.id;
        copyBtn.dataset.projectId = t.projectId;
        actWrap.appendChild(copyBtn);

        card.appendChild(actWrap);
      }
    }

    // Time range
    const tmDiv = document.createElement("div");
    tmDiv.className = "card-time";
    const endSlot = startSlot + dur;
    tmDiv.textContent = `${slot2time(startSlot)} – ${slot2time(endSlot)}`;
    card.appendChild(tmDiv);

    layer.appendChild(card);
  }
}

/* ── Current time line ── */

export function updateNowLine() {
  const line = $("nowLine");
  const now = new Date();
  const ds = fmtD(now);
  if (ds !== dateStr()) { line.style.display = "none"; return; }
  line.style.display = "";
  const minutes = now.getHours() * 60 + now.getMinutes();
  const top = (minutes / SLOT_MIN) * SLOT_H;
  line.style.top = `${top}px`;
}

export function scrollToNow() {
  const scroll = $("timelineScroll");
  const now = new Date();
  const ds = fmtD(now);
  let targetSlot;
  if (ds === dateStr()) {
    targetSlot = time2slot(`${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`);
  } else {
    targetSlot = 8 * PER_HOUR;
  }
  const targetTop = targetSlot * SLOT_H;
  const visible = scroll.clientHeight;
  scroll.scrollTop = Math.max(0, targetTop - visible * 0.3);
}
