/**
 * Review page — overview of completed tasks.
 * Shows summary by projects, progress bars, per-day/week stats.
 */
import { loadState } from "../shared/storage.js";
import { projColor } from "../shared/colors.js";
import { fmtD, fmtDateRu, dowRu, MONTHS_RU, t2m, m2t, SLOT_MIN } from "../shared/date-utils.js";

const $ = (id) => document.getElementById(id);

/* ── State ── */

let curDate = new Date();
let viewMode = "week"; // "day" | "week" | "month"
let filterPid = "";
let projects = [];
let tasks = [];

/* ── Period helpers ── */

function getPeriodDates() {
  if (viewMode === "day") {
    const ds = fmtD(curDate);
    return { start: ds, end: ds, dates: [ds] };
  }
  if (viewMode === "month") {
    // Last 30 days ending at curDate
    const dates = [];
    for (let i = 29; i >= 0; i--) {
      const dd = new Date(curDate);
      dd.setDate(dd.getDate() - i);
      dates.push(fmtD(dd));
    }
    return { start: dates[0], end: dates[dates.length - 1], dates };
  }
  // Week: Monday to Sunday
  const d = new Date(curDate);
  const day = d.getDay();
  const diff = day === 0 ? 6 : day - 1; // adjust for Monday start
  d.setDate(d.getDate() - diff);
  const dates = [];
  for (let i = 0; i < 7; i++) {
    const dd = new Date(d);
    dd.setDate(d.getDate() + i);
    dates.push(fmtD(dd));
  }
  return { start: dates[0], end: dates[6], dates };
}

function navPeriod(dir) {
  if (viewMode === "day") {
    curDate.setDate(curDate.getDate() + dir);
  } else if (viewMode === "week") {
    curDate.setDate(curDate.getDate() + dir * 7);
  } else {
    curDate.setDate(curDate.getDate() + dir * 30);
  }
  loadAndRender();
}

/* ── Period label ── */

function renderPeriodLabel() {
  const { dates } = getPeriodDates();
  const lbl = $("periodLabel");
  if (viewMode === "day") {
    const ds = dates[0];
    const isToday = ds === fmtD(new Date());
    lbl.innerHTML = `${fmtDateRu(ds)} ${curDate.getFullYear()} <span style="color:var(--muted);font-weight:400;margin-left:6px">${dowRu(ds)}</span>${isToday ? " — сегодня" : ""}`;
  } else if (viewMode === "week") {
    const first = dates[0];
    const last = dates[6];
    const [, m1, d1] = first.split("-").map(Number);
    const [, m2, d2] = last.split("-").map(Number);
    if (m1 === m2) {
      lbl.textContent = `${d1} – ${d2} ${MONTHS_RU[m1 - 1]} ${curDate.getFullYear()}`;
    } else {
      lbl.textContent = `${d1} ${MONTHS_RU[m1 - 1].slice(0, 3)} – ${d2} ${MONTHS_RU[m2 - 1]} ${curDate.getFullYear()}`;
    }
  } else {
    // Month: show first – last
    const first = dates[0];
    const last = dates[dates.length - 1];
    const [, m1, d1] = first.split("-").map(Number);
    const [, m2, d2] = last.split("-").map(Number);
    if (m1 === m2) {
      lbl.textContent = `${d1} – ${d2} ${MONTHS_RU[m1 - 1]} ${curDate.getFullYear()}`;
    } else {
      lbl.textContent = `${d1} ${MONTHS_RU[m1 - 1].slice(0, 3)} – ${d2} ${MONTHS_RU[m2 - 1].slice(0, 3)} ${curDate.getFullYear()}`;
    }
  }
}

/* ── Filter ── */

function renderFilter() {
  const sel = $("projectFilter");
  const curVal = sel.value;
  sel.innerHTML = '<option value="">Все проекты</option>';
  for (const p of projects.sort((a, b) => a.name.localeCompare(b.name))) {
    const o = document.createElement("option");
    o.value = p.id;
    o.textContent = p.name;
    if (p.id === curVal || p.id === filterPid) o.selected = true;
    sel.appendChild(o);
  }
  filterPid = sel.value;
}

/* ── Data: get tasks for period ── */

function getPeriodTasks() {
  const { start, end } = getPeriodDates();
  return tasks.filter((t) => {
    if (!t.doneAt) return false;
    const doneDate = fmtD(new Date(t.doneAt));
    if (doneDate < start || doneDate > end) return false;
    if (filterPid && String(t.projectId) !== String(filterPid)) return false;
    return true;
  });
}

function getAllPeriodTasks() {
  const { start, end } = getPeriodDates();
  return tasks.filter((t) => {
    const refDate = t.doneAt ? fmtD(new Date(t.doneAt)) : t.scheduledDate;
    if (!refDate) return false;
    if (refDate < start || refDate > end) return false;
    if (filterPid && String(t.projectId) !== String(filterPid)) return false;
    return true;
  });
}

/* ── Summary cards (by project) ── */

function renderSummary() {
  const row = $("summaryRow");
  row.innerHTML = "";

  const allTasks = getAllPeriodTasks();
  let targetProjects = projects;
  if (filterPid) targetProjects = projects.filter((p) => p.id === filterPid);

  if (targetProjects.length === 0) {
    row.innerHTML = '<p style="color:var(--muted);font-size:13px">Нет проектов</p>';
    return;
  }

  for (const proj of targetProjects.sort((a, b) => a.name.localeCompare(b.name))) {
    const projTasks = allTasks.filter((t) => String(t.projectId) === String(proj.id));
    const total = projTasks.length;
    const done = projTasks.filter((t) => t.status === "done").length;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    const color = projColor(proj.id, proj.color || null);

    let totalMin = 0;
    for (const t of projTasks) {
      if (t.status === "done" && t.duration) totalMin += t.duration * SLOT_MIN;
    }

    const card = document.createElement("div");
    card.className = "summary-card";
    card.style.borderLeftColor = color;

    card.innerHTML = `
      <div class="summary-card-header">
        <span class="summary-card-name" style="color:${color}">${escHtml(proj.name)}</span>
        <span class="summary-card-pct" style="color:${color}">${pct}%</span>
      </div>
      <div class="summary-progress">
        <div class="summary-progress-fill" style="width:${pct}%;background:${color}"></div>
      </div>
      <div class="summary-card-stats">
        <span class="summary-stat"><span class="num">${done}</span> выполнено</span>
        <span class="summary-stat"><span class="num">${total - done}</span> осталось</span>
        ${totalMin > 0 ? `<span class="summary-stat"><span class="num">${fmtMinutes(totalMin)}</span> затрачено</span>` : ""}
      </div>
    `;

    row.appendChild(card);
  }
}

/* ── Stats bar ── */

function renderStats() {
  const bar = $("statsBar");
  const doneTasks = getPeriodTasks();
  const allTasks = getAllPeriodTasks();
  const totalDone = doneTasks.length;
  const totalAll = allTasks.length;

  let totalMin = 0;
  for (const t of doneTasks) {
    if (t.duration) totalMin += t.duration * SLOT_MIN;
  }

  const activeProjects = new Set(doneTasks.map((t) => t.projectId)).size;

  bar.innerHTML = `
    <div class="stat-item">
      <span class="stat-value done-color">${totalDone}</span>
      <span class="stat-label">Выполнено</span>
    </div>
    <div class="stat-item">
      <span class="stat-value">${totalAll}</span>
      <span class="stat-label">Всего задач</span>
    </div>
    ${totalMin > 0 ? `
    <div class="stat-item">
      <span class="stat-value">${fmtMinutes(totalMin)}</span>
      <span class="stat-label">Затрачено времени</span>
    </div>` : ""}
    <div class="stat-item">
      <span class="stat-value">${activeProjects}</span>
      <span class="stat-label">Активных проектов</span>
    </div>
  `;
}

/* ── Workload chart ── */

function renderChart() {
  const chartEl = $("chart");
  const emptyEl = $("chartEmpty");
  const legendEl = $("chartLegend");
  chartEl.innerHTML = "";
  legendEl.innerHTML = "";

  const { dates } = getPeriodDates();
  const isWeekMode = dates.length > 1;
  const isMonthMode = dates.length > 7;

  // For month mode, wrap chart in scrollable container
  let chartContainer = chartEl;
  if (isMonthMode) {
    chartContainer = document.createElement("div");
    chartContainer.className = "chart-month-wrap";
    chartEl.appendChild(chartContainer);
  }

  // Filter projects
  let targetProjects = projects;
  if (filterPid) targetProjects = projects.filter((p) => p.id === filterPid);

  // Build data: { date -> { projectId -> minutes } }
  const dayData = {};
  let maxMin = 0;
  let hasAnyData = false;

  for (const ds of dates) {
    dayData[ds] = {};
    for (const proj of targetProjects) {
      dayData[ds][proj.id] = 0;
    }
  }

  for (const t of tasks) {
    if (t.status !== "done" || !t.doneAt) continue;
    if (!t.duration) continue;
    const doneDate = fmtD(new Date(t.doneAt));
    if (!(doneDate in dayData)) continue;
    if (filterPid && String(t.projectId) !== String(filterPid)) continue;
    const pid = String(t.projectId);
    const mins = t.duration * SLOT_MIN;
    dayData[doneDate][pid] = (dayData[doneDate][pid] || 0) + mins;
    if (mins > 0) hasAnyData = true;
  }

  if (!hasAnyData) {
    emptyEl.classList.remove("hidden");
    return;
  }
  emptyEl.classList.add("hidden");

  // Find max across all days for scale
  for (const ds of dates) {
    const dayTotal = Object.values(dayData[ds]).reduce((s, v) => s + v, 0);
    if (dayTotal > maxMin) maxMin = dayTotal;
  }

  // Collect active project IDs (those with data)
  const activePids = new Set();
  for (const ds of dates) {
    for (const [pid, mins] of Object.entries(dayData[ds])) {
      if (mins > 0) activePids.add(pid);
    }
  }

  // Render each day row
  let grandTotal = 0;
  for (const ds of dates) {
    const dayTotal = Object.values(dayData[ds]).reduce((s, v) => s + v, 0);
    grandTotal += dayTotal;

    const row = document.createElement("div");
    row.className = "chart-row" + (isMonthMode ? " chart-row-compact" : "");

    // Day label
    const label = document.createElement("div");
    label.className = "chart-label" + (isMonthMode ? " chart-label-compact" : "");
    if (isMonthMode) {
      const [, m, d] = ds.split("-").map(Number);
      label.textContent = `${d}.${m}`;
    } else if (isWeekMode) {
      const [, m, d] = ds.split("-").map(Number);
      label.innerHTML = `${d} ${MONTHS_RU[m - 1].slice(0, 3)}<br><span style=\"font-size:9px;opacity:.7\">${dowRu(ds)}</span>`;
    } else {
      label.textContent = dowRu(ds);
    }
    row.appendChild(label);

    // Bar
    const barWrap = document.createElement("div");
    barWrap.className = "chart-bar-wrap";

    for (const proj of targetProjects) {
      const mins = dayData[ds][proj.id] || 0;
      if (mins <= 0) continue;
      const color = projColor(proj.id, proj.color || null);
      const pct = maxMin > 0 ? (mins / maxMin) * 100 : 0;

      const seg = document.createElement("div");
      seg.className = "chart-bar-seg";
      seg.style.width = `${pct}%`;
      seg.style.background = color;
      seg.setAttribute("data-tip", `${proj.name}: ${fmtMinutes(mins)}`);
      barWrap.appendChild(seg);
    }

    row.appendChild(barWrap);

    // Value
    const value = document.createElement("div");
    value.className = "chart-value" + (isMonthMode ? " chart-value-compact" : "");
    value.textContent = dayTotal > 0 ? fmtMinutes(dayTotal) : "—";
    row.appendChild(value);

    chartContainer.appendChild(row);
  }

  // Grand total
  const totalRow = document.createElement("div");
  totalRow.className = "chart-total-row";
  totalRow.innerHTML = `<span>Итого</span><span class="chart-value">${fmtMinutes(grandTotal)}</span>`;
  chartContainer.appendChild(totalRow);

  // Legend
  for (const proj of targetProjects.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!activePids.has(proj.id)) continue;
    const color = projColor(proj.id, proj.color || null);
    const item = document.createElement("div");
    item.className = "chart-legend-item";
    item.innerHTML = `<span class="chart-legend-dot" style="background:${color}"></span>${escHtml(proj.name)}`;
    legendEl.appendChild(item);
  }
}

/* ── Task list ── */

function renderTasks() {
  const list = $("tasksList");
  const emptyEl = $("tasksEmpty");
  const countEl = $("tasksCount");
  list.innerHTML = "";

  const doneTasks = getPeriodTasks().sort((a, b) => {
    const da = a.doneAt ? new Date(a.doneAt).getTime() : 0;
    const db = b.doneAt ? new Date(b.doneAt).getTime() : 0;
    return db - da;
  });

  countEl.textContent = doneTasks.length > 0 ? `(${doneTasks.length})` : "";

  if (doneTasks.length === 0) {
    emptyEl.classList.remove("hidden");
    return;
  }
  emptyEl.classList.add("hidden");

  for (const t of doneTasks) {
    const proj = projects.find((p) => p.id === t.projectId);
    const color = projColor(t.projectId, proj && proj.color ? proj.color : null);
    const doneTime = t.doneAt ? new Date(t.doneAt) : null;

    const item = document.createElement("div");
    item.className = "review-task";
    item.style.borderLeftColor = color;

    const check = document.createElement("div");
    check.className = "review-task-check";
    check.textContent = "✓";
    item.appendChild(check);

    const body = document.createElement("div");
    body.className = "review-task-body";

    const projSpan = document.createElement("div");
    projSpan.className = "review-task-proj";
    projSpan.style.color = color;
    projSpan.textContent = proj ? proj.name : "—";
    body.appendChild(projSpan);

    const txtSpan = document.createElement("div");
    txtSpan.className = "review-task-text";
    txtSpan.textContent = t.taskText;
    body.appendChild(txtSpan);

    if (t.scheduledTime && t.duration) {
      const meta = document.createElement("div");
      meta.className = "review-task-meta";
      const endMin = t2m(t.scheduledTime) + (t.duration || 1) * SLOT_MIN;
      meta.innerHTML = `<span>${t.scheduledTime} – ${m2t(endMin)} (${t.duration * SLOT_MIN} мин)</span>`;
      body.appendChild(meta);
    }

    item.appendChild(body);

    if (doneTime) {
      const timeSpan = document.createElement("div");
      timeSpan.className = "review-task-time";
      timeSpan.textContent = doneTime.toLocaleString("ru-RU", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
      item.appendChild(timeSpan);
    }

    list.appendChild(item);
  }
}

/* ── Helpers ── */

function escHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function fmtMinutes(min) {
  if (min < 60) return `${min} мин`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h} ч ${m} мин` : `${h} ч`;
}

/* ── Main render ── */

async function loadAndRender() {
  const state = await loadState();
  projects = state.projects;
  tasks = state.tasks;

  renderPeriodLabel();
  renderFilter();
  renderSummary();
  renderStats();
  renderChart();
  renderTasks();
}

/* ── Init ── */

function init() {
  $("viewMode").value = viewMode;

  $("btnPrev").addEventListener("click", () => navPeriod(-1));
  $("btnNext").addEventListener("click", () => navPeriod(1));
  $("btnToday").addEventListener("click", () => {
    curDate = new Date();
    loadAndRender();
  });

  $("viewMode").addEventListener("change", (e) => {
    viewMode = e.target.value;
    loadAndRender();
  });

  $("projectFilter").addEventListener("change", () => {
    filterPid = $("projectFilter").value;
    renderSummary();
    renderStats();
    renderChart();
    renderTasks();
  });

  $("btnBackTimeline").addEventListener("click", () => {
    window.location.href = "timeline.html";
  });

  // Keyboard shortcuts
  document.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") navPeriod(-1);
    if (e.key === "ArrowRight") navPeriod(1);
    if (e.key === "t" || e.key === "T" || e.key === "з" || e.key === "З") {
      curDate = new Date();
      loadAndRender();
    }
  });

  // Sync with storage changes
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.projects || changes.tasks) loadAndRender();
  });

  loadAndRender();
}

document.addEventListener("DOMContentLoaded", init);
