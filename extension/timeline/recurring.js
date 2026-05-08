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

/** Task ID to link after creating a recurring template from it */
let _sourceTaskId = null;
/** ID of the recurring template being edited (null = add mode) */
let _editId = null;

export function openRecurringModal(prefill = null) {
  _editId = null;
  _sourceTaskId = null;
  resetRecForm();
  renderRecurringList();

  // Pre-fill from task data if provided
  if (prefill) {
    $("recProject").value = prefill.projectId || "";
    $("recText").value = prefill.taskText || "";
    $("recTime").value = prefill.scheduledTime || "09:00";
    $("recDuration").value = String(prefill.duration || 2);
    // Check the day of week of the task's scheduled date
    if (prefill.scheduledDate) {
      const dow = new Date(prefill.scheduledDate + "T00:00:00").getDay();
      const cb = document.getElementById("recDow" + dow);
      if (cb) cb.checked = true;
    }
    _sourceTaskId = prefill.taskId || null;
  }

  updateRecFormMode();
  $("recurringModalOverlay").classList.remove("hidden");
}

export function closeRecurringModal() {
  $("recurringModalOverlay").classList.add("hidden");
  _editId = null;
  _sourceTaskId = null;
}

/** Reset form to default empty state */
function resetRecForm() {
  $("recText").value = "";
  $("recTime").value = "09:00";
  $("recDuration").value = "2";
  for (let d = 0; d <= 6; d++) {
    const cb = document.getElementById("recDow" + d);
    if (cb) cb.checked = false;
  }
}

/** Update button labels based on add/edit mode */
function updateRecFormMode() {
  const saveBtn = $("btnRecSave");
  const cancelBtn = $("btnRecCancel");
  if (_editId) {
    saveBtn.textContent = "Сохранить";
    cancelBtn.classList.remove("hidden");
  } else {
    saveBtn.textContent = "Добавить";
    cancelBtn.classList.add("hidden");
  }
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
        <button type="button" class="recurring-edit" data-rid="${r.id}" title="Редактировать">edit</button>
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

/* ── Edit recurring template ── */

function editRecurring(rid) {
  const r = tl.recurring.find((x) => x.id === rid);
  if (!r) return;

  _editId = rid;
  _sourceTaskId = null;

  // Populate form from template
  $("recProject").value = r.projectId;
  $("recText").value = r.taskText;
  $("recTime").value = r.scheduledTime;
  $("recDuration").value = String(r.duration);
  for (let d = 0; d <= 6; d++) {
    const cb = document.getElementById("recDow" + d);
    if (cb) cb.checked = r.daysOfWeek.includes(d);
  }

  updateRecFormMode();
  $("recText").focus();
}

/** Cancel edit mode, reset form */
function cancelRecEdit() {
  _editId = null;
  _sourceTaskId = null;
  resetRecForm();
  updateRecFormMode();
}

/* ── Save recurring task (create or update) ── */

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

  if (_editId) {
    // Update existing template
    const recurring = tl.recurring.map((r) =>
      r.id === _editId
        ? { ...r, projectId: pid, taskText: text, scheduledTime: time, duration: dur, daysOfWeek: days }
        : r
    );
    await persistRecurring(recurring);
    _editId = null;
    toast("Шаблон обновлён", "ok");
  } else {
    // Create new template
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

    // Link the source task to the newly created recurring template
    if (_sourceTaskId) {
      const tasks = tl.tasks.map((t) =>
        t.id === _sourceTaskId ? { ...t, recurringId: entry.id } : t
      );
      await persistTasks(tasks);
      _sourceTaskId = null;
    }

    toast("Периодическая задача добавлена", "ok");
  }

  renderRecurringList();
  resetRecForm();
  updateRecFormMode();
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
    const editBtn = e.target.closest(".recurring-edit");
    if (editBtn) {
      editRecurring(editBtn.dataset.rid);
      return;
    }
    const delBtn = e.target.closest(".recurring-del");
    if (delBtn) {
      deleteRecurring(delBtn.dataset.rid);
      return;
    }
  });
  $("btnRecCancel").addEventListener("click", cancelRecEdit);

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
