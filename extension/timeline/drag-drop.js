/**
 * Timeline drag & drop — handles dragging task cards between slots, days, and sidebar.
 * Uses event delegation on taskLayer and unscheduledList (cards have data-task-id).
 */
import { SLOT_H, TOTAL_SLOTS, fmtD, slot2time, time2slot } from "../shared/date-utils.js";
import { tl, reload, persistTasks, dateStr } from "./state.js";
import { renderCards, renderUnscheduled, loadAndRender, scrollToNow } from "./render.js";
import { toast } from "./ui.js";

const $ = (id) => document.getElementById(id);

/* ── Card drag start/end (event delegation) ── */

function onCardDragStart(e, taskId) {
  tl.dragId = taskId;
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", taskId);
  const card = e.target.closest(".task-card, .unscheduled-card");
  if (card) setTimeout(() => card.classList.add("dragging"), 0);

  // Disable pointer-events on OTHER task cards so they don't steal dragover
  document.querySelectorAll(".task-card").forEach((c) => {
    if (c !== card) c.style.pointerEvents = "none";
  });

  $("btnPrevDay").classList.add("drop-target");
  $("btnNextDay").classList.add("drop-target");
}

function onCardDragEnd(e) {
  tl.dragId = null;
  const card = e.target.closest(".task-card, .unscheduled-card");
  if (card) card.classList.remove("dragging");
  document.querySelectorAll(".task-card").forEach((c) => { c.style.pointerEvents = ""; });
  $("btnPrevDay").classList.remove("drop-target", "drop-hover");
  $("btnNextDay").classList.remove("drop-target", "drop-hover");
  clearSlotHighlight();
  $("unscheduledPanel").classList.remove("sidebar-drag-over");
}

/* ── Slot helpers ── */

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

/* ── Setup: event delegation for card drag ── */

export function setupCardDragDelegation() {
  const taskLayer = $("taskLayer");
  const unschedList = $("unscheduledList");

  // Drag start
  for (const parent of [taskLayer, unschedList]) {
    parent.addEventListener("dragstart", (e) => {
      const card = e.target.closest("[data-task-id]");
      if (card) onCardDragStart(e, card.dataset.taskId);
    });
    parent.addEventListener("dragend", (e) => {
      onCardDragEnd(e);
    });
  }
}

/* ── Timeline drop (bodyCol) ── */

export function setupTimelineDrop() {
  const bodyCol = $("bodyCol");

  bodyCol.addEventListener("dragover", (e) => {
    if (!tl.dragId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    highlightSlot(getSlotFromY(e.clientY));
  });

  bodyCol.addEventListener("dragleave", (e) => {
    if (!bodyCol.contains(e.relatedTarget)) clearSlotHighlight();
  });

  bodyCol.addEventListener("drop", async (e) => {
    const taskId = tl.dragId;
    if (!taskId) return;
    tl.dragId = null;
    e.preventDefault();
    clearSlotHighlight();

    const slotIndex = getSlotFromY(e.clientY);
    const newTime = slot2time(slotIndex);
    const ds = dateStr();

    const tasks = tl.tasks.map((t) =>
      t.id === taskId ? { ...t, scheduledDate: ds, scheduledTime: newTime, duration: t.duration || 1 } : t
    );
    await persistTasks(tasks);
    renderCards();
    renderUnscheduled();
    toast("Задача перемещена", "ok");
  });
}

/* ── Sidebar drop ── */

export function setupSidebarDrop() {
  const panel = $("unscheduledPanel");

  panel.addEventListener("dragover", (e) => {
    if (!tl.dragId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    panel.classList.add("sidebar-drag-over");
  });

  panel.addEventListener("dragleave", (e) => {
    if (!panel.contains(e.relatedTarget)) panel.classList.remove("sidebar-drag-over");
  });

  panel.addEventListener("drop", async (e) => {
    const taskId = tl.dragId;
    if (!taskId) return;
    tl.dragId = null;
    e.preventDefault();
    panel.classList.remove("sidebar-drag-over");

    const tasks = tl.tasks.map((t) =>
      t.id === taskId ? { ...t, scheduledDate: undefined, scheduledTime: undefined } : t
    );
    await persistTasks(tasks);
    renderCards();
    renderUnscheduled();
    toast("Задача убрана из расписания", "ok");
  });
}

/* ── Day drop (prev / next buttons) ── */

export function setupDayDrop(btn, deltaDays) {
  btn.addEventListener("dragover", (e) => {
    if (!tl.dragId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    btn.classList.add("drop-hover");
  });
  btn.addEventListener("dragleave", () => btn.classList.remove("drop-hover"));
  btn.addEventListener("drop", async (e) => {
    const taskId = tl.dragId;
    if (!taskId) return;
    tl.dragId = null;
    e.preventDefault();
    btn.classList.remove("drop-hover");

    await reload();
    const task = tl.tasks.find((t) => t.id === taskId);
    if (!task) return;

    const targetDate = new Date(dateStr() + "T00:00:00");
    targetDate.setDate(targetDate.getDate() + deltaDays);
    const targetDs = fmtD(targetDate);
    const time = task.scheduledTime || "09:00";

    const tasks = tl.tasks.map((t) =>
      t.id === taskId ? { ...t, scheduledDate: targetDs, scheduledTime: time, duration: t.duration || 1 } : t
    );
    await persistTasks(tasks);

    tl.curDate = targetDate;
    loadAndRender();
    scrollToNow();
    toast("Задача перенесена", "ok");
  });
}
