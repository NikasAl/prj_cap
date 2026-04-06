/**
 * Timeline modal — task CRUD via modal dialog.
 * Uses event delegation for card clicks (open modal, toggle done).
 */
import { slot2time } from "../shared/date-utils.js";
import { uid } from "../shared/storage.js";
import { tl, reload, persistTasks, dateStr } from "./state.js";
import { renderCards, renderUnscheduled, loadAndRender, scrollToNow } from "./render.js";
import { cleanupRecording } from "./voice.js";
import { toast } from "./ui.js";

const $ = (id) => document.getElementById(id);

/* ── Open / Close ── */

export function openModal(mode, slotIndex = null, taskId = null) {
  tl.editId = mode === "edit" ? taskId : null;
  const title = $("modalTitle");

  // Populate project selector
  const pSel = $("mProject");
  pSel.innerHTML = "";
  if (tl.projects.length === 0) {
    pSel.innerHTML = '<option value="">— нет проектов —</option>';
  } else {
    for (const p of tl.projects.sort((a, b) => a.name.localeCompare(b.name))) {
      const o = document.createElement("option");
      o.value = p.id;
      o.textContent = p.name;
      pSel.appendChild(o);
    }
  }

  if (mode === "edit" && taskId) {
    title.textContent = "Редактировать задачу";
    const t = tl.tasks.find((x) => x.id === taskId);
    if (!t) return;
    pSel.value = t.projectId;
    $("mText").value = t.taskText;
    $("mDate").value = t.scheduledDate || dateStr();
    $("mTime").value = t.scheduledTime || slot2time(slotIndex || 0);
    $("mDuration").value = String(t.duration || 1);
    $("mStatus").value = t.status || "open";
    $("mStatusWrap").classList.remove("hidden");
    $("btnMDelete").classList.remove("hidden");
  } else {
    title.textContent = "Новая задача";
    pSel.value = tl.filterPid || (tl.projects[0] ? tl.projects[0].id : "");
    $("mText").value = "";
    $("mDate").value = dateStr();
    $("mTime").value = slotIndex != null ? slot2time(slotIndex) : "09:00";
    $("mDuration").value = "1";
    $("mStatus").value = "open";
    $("mStatusWrap").classList.add("hidden");
    $("btnMDelete").classList.add("hidden");
  }

  $("modalOverlay").classList.remove("hidden");
  $("mText").focus();
}

export function closeModal() {
  cleanupRecording();
  $("modalOverlay").classList.add("hidden");
  tl.editId = null;
}

/* ── Save / Delete ── */

export async function saveModal() {
  const pid = $("mProject").value;
  const text = $("mText").value.trim();
  const date = $("mDate").value;
  const time = $("mTime").value;
  const dur = parseInt($("mDuration").value, 10);

  if (!pid) { toast("Выберите проект", "err"); return; }
  if (!text) { toast("Введите текст задачи", "err"); return; }
  if (!date) { toast("Укажите дату", "err"); return; }
  if (!time) { toast("Укажите время", "err"); return; }

  await reload();

  if (tl.editId) {
    const newStatus = $("mStatus").value;
    const tasks = tl.tasks.map((t) =>
      t.id === tl.editId
        ? { ...t, projectId: pid, taskText: text, scheduledDate: date, scheduledTime: time, duration: dur, status: newStatus,
            ...(newStatus === "done" ? { doneAt: new Date().toISOString() } : {}),
            ...(newStatus !== "done" ? { doneAt: undefined } : {}) }
        : t
    );
    await persistTasks(tasks);
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
    await persistTasks([...tl.tasks, task]);
    toast("Задача создана", "ok");
  }

  closeModal();

  if (date === dateStr()) {
    renderCards();
  } else {
    tl.curDate = new Date(date + "T00:00:00");
    loadAndRender();
    scrollToNow();
  }
}

export async function deleteModal() {
  if (!tl.editId) return;
  const t = tl.tasks.find((x) => x.id === tl.editId);
  if (!t) return;
  if (!confirm(`Удалить задачу «${t.taskText.slice(0, 60)}»?`)) return;

  await reload();
  const tasks = tl.tasks.filter((x) => x.id !== tl.editId);
  await persistTasks(tasks);
  closeModal();
  renderCards();
  renderUnscheduled();
  toast("Задача удалена", "ok");
}

/* ── Toggle done (from card check button) ── */

export async function toggleTaskDone(taskId) {
  await reload();
  const t = tl.tasks.find((x) => x.id === taskId);
  if (!t) return;
  const newStatus = t.status === "done" ? "open" : "done";
  const tasks = tl.tasks.map((x) =>
    x.id === taskId
      ? { ...x, status: newStatus, ...(newStatus === "done" ? { doneAt: new Date().toISOString() } : { doneAt: undefined }) }
      : x
  );
  await persistTasks(tasks);
  renderCards();
  renderUnscheduled();
  toast(newStatus === "done" ? "Задача выполнена" : "Задача возвращена в работу", "ok");
}

/* ── Event delegation for card clicks and slot double-click ── */

export function setupModalDelegation() {
  // Card clicks: edit task or toggle done
  const taskLayer = $("taskLayer");
  taskLayer.addEventListener("click", (e) => {
    // Action buttons (chat, copy) — handled by app.js, skip here
    if (e.target.closest(".card-actions")) return;
    // Check button
    const checkBtn = e.target.closest(".card-done-btn");
    if (checkBtn) {
      e.stopPropagation();
      const card = checkBtn.closest("[data-task-id]");
      if (card) toggleTaskDone(card.dataset.taskId);
      return;
    }
    // Card click → open modal
    const card = e.target.closest(".task-card");
    if (!card || card.classList.contains("dragging")) return;
    openModal("edit", null, card.dataset.taskId);
  });

  // Unscheduled card clicks
  const unschedList = $("unscheduledList");
  unschedList.addEventListener("click", (e) => {
    const card = e.target.closest(".unscheduled-card");
    if (!card || card.classList.contains("dragging")) return;
    openModal("edit", null, card.dataset.taskId);
  });

  // Slot double-click → open modal for new task
  document.addEventListener("tl:openModal", (e) => {
    const { mode, slotIndex } = e.detail;
    openModal(mode, slotIndex);
  });

  // Modal overlay click → close
  $("modalOverlay").addEventListener("click", (e) => {
    if (e.target === $("modalOverlay")) closeModal();
  });

  // Modal buttons
  $("btnMSave").addEventListener("click", saveModal);
  $("btnMDelete").addEventListener("click", deleteModal);
  $("btnMCancel").addEventListener("click", closeModal);
}
