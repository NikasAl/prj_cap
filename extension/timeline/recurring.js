/**
 * Recurring tasks — periodic task templates.
 * Enabled recurring tasks auto-generate copies in the schedule on their active days.
 */
import { uid } from "../shared/storage.js";
import { tl, reload, persistTasks, persistRecurring, dateStr } from "./state.js";
import { renderCards, renderUnscheduled, loadAndRender } from "./render.js";
import { toast } from "./ui.js";

const $ = (id) => document.getElementById(id);

const DOW_LABELS = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
const DOW_FULL = ["Воскресенье", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"];

/* ── Spawn recurring tasks for a date ── */

export async function spawnRecurringForDate(dateString) {
  await reload();
  const dow = new Date(dateString + "T00:00:00").getDay(); // 0=Sun..6=Sat
  const enabled = tl.recurring.filter((r) => r.enabled && r.daysOfWeek.includes(dow));
  if (enabled.length === 0) return;

  // Check which tasks already exist for this date from recurring templates
  const existing = new Set(
    tl.tasks
      .filter((t) => t.scheduledDate === dateString && t.recurringId)
      .map((t) => t.recurringId)
  );

  const newTasks = [];
  for (const r of enabled) {
    if (existing.has(r.id)) continue; // already spawned today
    newTasks.push({
      id: uid(),
      projectId: r.projectId,
      taskText: r.taskText,
      status: "open",
      createdAt: new Date().toISOString(),
      scheduledDate: dateString,
      scheduledTime: r.scheduledTime,
      duration: r.duration,
      recurringId: r.id,
    });
  }

  if (newTasks.length > 0) {
    await persistTasks([...tl.tasks, ...newTasks]);
  }
}

/* ── Open / Close recurring modal ── */

export function openRecurringModal() {
  renderRecurringList();
  $("recurringModalOverlay").classList.remove("hidden");
}

export function closeRecurringModal() {
  $("recurringModalOverlay").classList.add("hidden");
}

/* ── Render the list ── */

function renderRecurringList() {
  const list = $("recurringList");
  const emptyEl = $("recurringEmpty");
  list.innerHTML = "";

  const sorted = [...tl.recurring].sort((a, b) => {
    const pa = tl.projects.find((p) => p.id === a.projectId);
    const pb = tl.projects.find((p) => p.id === b.projectId);
    const na = pa ? pa.name : "";
    const nb = pb ? pb.name : "";
    if (na !== nb) return na.localeCompare(nb);
    return a.taskText.localeCompare(b.taskText);
  });

  if (sorted.length === 0) {
    emptyEl.classList.remove("hidden");
    return;
  }
  emptyEl.classList.add("hidden");

  for (const r of sorted) {
    const proj = tl.projects.find((p) => p.id === r.projectId);
    const projName = proj ? proj.name : "—";
    const days = r.daysOfWeek.map((d) => DOW_LABELS[d]).join(", ");

    const item = document.createElement("div");
    item.className = "recurring-item" + (r.enabled ? "" : " recurring-item-disabled");

    item.innerHTML = `
      <div class="recurring-info">
        <div class="recurring-proj" style="color:${proj ? proj.color || "var(--muted)" : "var(--muted)"}">${projName}</div>
        <div class="recurring-text">${escHtml(r.taskText)}</div>
        <div class="recurring-meta">${r.scheduledTime} / ${r.duration * 15} мин — ${days}</div>
      </div>
      <div class="recurring-actions">
        <button type="button" class="recurring-toggle" data-rid="${r.id}" title="${r.enabled ? "Отключить" : "Включить"}">${r.enabled ? "ON" : "OFF"}</button>
        <button type="button" class="recurring-del" data-rid="${r.id}" title="Удалить">x</button>
      </div>
    `;
    list.appendChild(item);
  }
}

/* ── Toggle enable/disable ── */

async function toggleRecurring(rid) {
  await reload();
  const recurring = tl.recurring.map((r) =>
    r.id === rid ? { ...r, enabled: !r.enabled } : r
  );
  await persistRecurring(recurring);
  renderRecurringList();
  toast("Шаблон " + (recurring.find((r) => r.id === rid)?.enabled ? "включён" : "отключён"), "ok");
}

/* ── Delete ── */

async function deleteRecurring(rid) {
  const r = tl.recurring.find((x) => x.id === rid);
  if (!r) return;
  if (!confirm(`Удалить периодическую задачу «${r.taskText.slice(0, 60)}»?`)) return;

  await reload();
  const recurring = tl.recurring.filter((x) => x.id !== rid);
  await persistRecurring(recurring);
  renderRecurringList();
  toast("Шаблон удалён", "ok");
}

/* ── Save new recurring task ── */

async function saveRecurring() {
  const pid = $("recProject").value;
  const text = $("recText").value.trim();
  const time = $("recTime").value;
  const dur = parseInt($("recDuration").value, 10);

  if (!pid) { toast("Выберите проект", "err"); return; }
  if (!text) { toast("Введите текст задачи", "err"); return; }
  if (!time) { toast("Укажите время", "err"); return; }

  // Collect selected days
  const days = [];
  for (let d = 0; d <= 6; d++) {
    const cb = document.getElementById("recDow" + d);
    if (cb && cb.checked) days.push(d);
  }
  if (days.length === 0) { toast("Выберите хотя бы один день недели", "err"); return; }

  await reload();

  const entry = {
    id: uid(),
    projectId: pid,
    taskText: text,
    scheduledTime: time,
    duration: dur,
    daysOfWeek: days,
    enabled: true,
  };

  await persistRecurring([...tl.recurring, entry]);
  renderRecurringList();

  // Reset form
  $("recText").value = "";
  for (let d = 0; d <= 6; d++) {
    const cb = document.getElementById("recDow" + d);
    if (cb) cb.checked = false;
  }
  toast("Периодическая задача добавлена", "ok");
}

/* ── Helper ── */

function escHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

/* ── Event wiring ── */

export function setupRecurring() {
  $("btnRecurring").addEventListener("click", openRecurringModal);
  $("btnRecurringClose").addEventListener("click", closeRecurringModal);
  $("recurringModalOverlay").addEventListener("click", (e) => {
    if (e.target === $("recurringModalOverlay")) closeRecurringModal();
  });
  $("btnRecSave").addEventListener("click", saveRecurring);

  // Toggle / delete delegation
  $("recurringList").addEventListener("click", (e) => {
    const toggleBtn = e.target.closest(".recurring-toggle");
    if (toggleBtn) {
      toggleRecurring(toggleBtn.dataset.rid);
      return;
    }
    const delBtn = e.target.closest(".recurring-del");
    if (delBtn) {
      deleteRecurring(delBtn.dataset.rid);
      return;
    }
  });

  // Keyboard: Escape to close
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("recurringModalOverlay").classList.contains("hidden")) {
      closeRecurringModal();
    }
  });

  // Populate project selector in form
  populateRecProjectSelector();
}

export async function populateRecProjectSelector() {
  await reload();
  const sel = $("recProject");
  sel.innerHTML = "";
  if (tl.projects.length === 0) {
    sel.innerHTML = '<option value="">— нет проектов —</option>';
  } else {
    for (const p of tl.projects.sort((a, b) => a.name.localeCompare(b.name))) {
      const o = document.createElement("option");
      o.value = p.id;
      o.textContent = p.name;
      sel.appendChild(o);
    }
  }
}
