/**
 * Timeline app — initialization, event wiring, keyboard shortcuts.
 * Entry point for timeline.html.
 */
import { loadAndRender, loadSpawnAndRender, buildTimeLabels, buildSlotGrid, updateNowLine, scrollToNow } from "./render.js";
import { navDate, goToday, onFilterChange } from "./date-nav.js";
import { setupCardDragDelegation, setupTimelineDrop, setupSidebarDrop, setupDayDrop } from "./drag-drop.js";
import { setupModalDelegation, closeModal, openModal } from "./modal.js";
import { setupProjectModal, closeProjectModal } from "./project-modal.js";
import { setupRecurring, spawnRecurringForDate, populateRecProjectSelector } from "./recurring.js";
import { initVoiceInput, toggleRecording } from "./voice.js";
import { initAssistant, toggleAssistant, isAssistantOpen } from "./assistant.js";
import { buildTaskMessage } from "../shared/message-builder.js";
import { tl, reload } from "./state.js";
import { toast } from "./ui.js";

const $ = (id) => document.getElementById(id);

function init() {
  // Navigation
  $("btnPrevDay").addEventListener("click", () => navDate(-1));
  $("btnNextDay").addEventListener("click", () => navDate(1));
  $("btnToday").addEventListener("click", goToday);
  $("projectFilter").addEventListener("change", onFilterChange);
  $("btnAddTask").addEventListener("click", () => openModal("add"));

  // Open review page
  $("btnOpenReview").addEventListener("click", () => {
    window.location.href = "review.html";
  });

  // Drag & drop
  setupCardDragDelegation();
  setupTimelineDrop();
  setupSidebarDrop();
  setupDayDrop($("btnPrevDay"), -1);
  setupDayDrop($("btnNextDay"), 1);

  // Modal event delegation (card clicks, slot dblclick, modal buttons)
  setupModalDelegation();

  // Project modal
  setupProjectModal();

  // Recurring tasks
  setupRecurring();

  // Card action buttons: chat & copy prompt (event delegation)
  setupCardActions();

  // Voice input
  initVoiceInput();

  // AI assistant
  initAssistant();

  // Build static grid
  buildTimeLabels();
  buildSlotGrid();

  // Keyboard shortcuts
  document.addEventListener("keydown", (e) => {
    // AI assistant shortcut: Ctrl+Shift+A
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'A' || e.key === 'a' || e.key === 'Ф' || e.key === 'ф')) {
      e.preventDefault();
      toggleAssistant();
      return;
    }
    if ($("modalOverlay").classList.contains("hidden") && $("projectModalOverlay").classList.contains("hidden") && !isAssistantOpen()) {
      if (e.key === "ArrowLeft") navDate(-1);
      if (e.key === "ArrowRight") navDate(1);
      if (e.key === "t" || e.key === "T" || e.key === "з" || e.key === "З") goToday();
    } else {
      if (e.key === "Escape") {
        // Close assistant first if open
        if (isAssistantOpen()) {
          toggleAssistant();
          return;
        }
        if (!$("projectModalOverlay").classList.contains("hidden")) closeProjectModal();
        else closeModal();
      }
      // Voice dictation: Ctrl+' (or Ctrl+э in Russian layout)
      if ((e.ctrlKey || e.metaKey) && (e.key === "э" || e.key === "'")) {
        e.preventDefault();
        toggleRecording();
      }
    }
  });

  // Sidebar resize
  initSidebarResize();

  // Initial render (spawn recurring tasks for today)
  loadSpawnAndRender().then(scrollToNow);

  // Periodic now-line update
  setInterval(updateNowLine, 30000);

  // Sync with storage changes from popup / background
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.projects || changes.tasks || changes.recurring) {
      loadAndRender();
      reload(); // keep assistant state fresh
    }
  });
}

function initSidebarResize() {
  const panel = $("unscheduledPanel");
  const handle = $("resizeHandle");
  if (!panel || !handle) return;

  let startX, startW;

  function onMouseMove(e) {
    const dx = e.clientX - startX;
    const newW = Math.max(140, Math.min(startW + dx, window.innerWidth * 0.5));
    panel.style.width = `${newW}px`;
  }

  function onMouseUp() {
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
    handle.classList.remove("active");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    // Persist width
    localStorage.setItem("prjcap_sidebar_w", panel.style.width);
  }

  handle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    startX = e.clientX;
    startW = panel.offsetWidth;
    handle.classList.add("active");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  });

  // Restore saved width
  const saved = localStorage.getItem("prjcap_sidebar_w");
  if (saved) panel.style.width = saved;
}

document.addEventListener("DOMContentLoaded", init);

/* ── Card action delegation: open chat, copy prompt ── */

function setupCardActions() {
  const taskLayer = $("taskLayer");
  taskLayer.addEventListener("click", (e) => {
    const chatBtn = e.target.closest(".card-act-chat");
    if (chatBtn) {
      e.stopPropagation();
      openAgentChat(chatBtn.dataset.projectId);
      return;
    }
    const sendBtn = e.target.closest(".card-act-send");
    if (sendBtn) {
      e.stopPropagation();
      sendToAgent(sendBtn.dataset.projectId);
      return;
    }
    const copyBtn = e.target.closest(".card-act-copy");
    if (copyBtn) {
      e.stopPropagation();
      copyTaskPrompt(copyBtn.dataset.taskId, copyBtn.dataset.projectId);
      return;
    }
    const logBtn = e.target.closest(".card-act-log");
    if (logBtn) {
      e.stopPropagation();
      showAgentLog(logBtn.dataset.taskId);
      return;
    }
  });
}

async function openAgentChat(projectId) {
  const project = tl.projects.find((p) => String(p.id) === String(projectId));
  if (!project || !project.chatUrl) {
    toast("У проекта не задан URL чата", "err");
    return;
  }
  try {
    const res = await chrome.runtime.sendMessage({ action: "openChatAndPasteNext", projectId });
    if (!res || !res.ok) {
      toast((res && res.error) || "Ошибка", "err");
      return;
    }
    if (res.pasted) {
      toast("Чат открыт, промпт вставлен", "ok");
    } else {
      toast("Чат открыт. Вставьте промпт вручную", "ok");
      if (res.message) await navigator.clipboard.writeText(res.message);
    }
    // Refresh to update sent status
    await reload();
    loadAndRender();
  } catch (err) {
    toast(String(err.message || err), "err");
  }
}

async function sendToAgent(projectId) {
  const project = tl.projects.find((p) => String(p.id) === String(projectId));
  if (!project || !project.chatUrl) {
    toast("У проекта не задан URL чата", "err");
    return;
  }
  try {
    toast("Отправляю задачу агенту…");
    const res = await chrome.runtime.sendMessage({ action: "openChatAndSendNext", projectId });
    if (!res || !res.ok) {
      toast((res && res.error) || "Ошибка", "err");
      return;
    }
    if (!res.pasted) {
      toast("Вставка не сработала", "err");
      if (res.message) await navigator.clipboard.writeText(res.message);
      return;
    }
    if (!res.sent) {
      toast("Вставлено, но отправить не удалось", "err");
      return;
    }
    toast(res.monitored ? "Задача отправлена, мониторинг запущен" : "Задача отправлена", "ok");
    await reload();
    loadAndRender();
  } catch (err) {
    toast(String(err.message || err), "err");
  }
}

async function showAgentLog(taskId) {
  await reload();
  const task = tl.tasks.find((t) => t.id === taskId);
  if (!task || !task.agentLog) {
    toast("Лог не найден", "err");
    return;
  }
  // Open in a simple overlay modal
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.style.cursor = "pointer";
  const modal = document.createElement("div");
  modal.className = "modal";
  modal.style.cursor = "default";
  modal.style.width = "560px";
  modal.style.maxHeight = "80vh";

  const header = document.createElement("h2");
  header.textContent = "Лог агента";
  header.style.marginBottom = "8px";
  modal.appendChild(header);

  const taskLabel = document.createElement("div");
  taskLabel.style.cssText = "font-size:12px;color:var(--muted);margin-bottom:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
  taskLabel.textContent = task.taskText;
  taskLabel.title = task.taskText;
  modal.appendChild(taskLabel);

  const pre = document.createElement("pre");
  pre.style.cssText = "flex:1;min-height:200px;max-height:55vh;overflow-y:auto;padding:10px 12px;border:1px solid var(--border);border-radius:8px;background:var(--bg);font-size:11px;line-height:1.5;white-space:pre-wrap;word-break:break-word;margin:0;scrollbar-width:thin;scrollbar-color:var(--border) transparent;";
  pre.textContent = task.agentLog;
  modal.appendChild(pre);

  const actions = document.createElement("div");
  actions.className = "modal-actions";
  actions.style.marginTop = "12px";

  const btnCopy = document.createElement("button");
  btnCopy.type = "button";
  btnCopy.className = "btn";
  btnCopy.textContent = "Копировать";
  btnCopy.addEventListener("click", async () => {
    await navigator.clipboard.writeText(task.agentLog);
    toast("Лог скопирован", "ok");
  });

  const btnClose = document.createElement("button");
  btnClose.type = "button";
  btnClose.className = "btn primary";
  btnClose.textContent = "Закрыть";
  btnClose.addEventListener("click", () => overlay.remove());

  actions.appendChild(btnCopy);
  actions.appendChild(btnClose);
  modal.appendChild(actions);
  overlay.appendChild(modal);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

async function copyTaskPrompt(taskId, projectId) {
  await reload();
  const task = tl.tasks.find((t) => t.id === taskId);
  const project = tl.projects.find((p) => String(p.id) === String(projectId));
  if (!task || !project) {
    toast("Задача или проект не найдены", "err");
    return;
  }
  const msg = buildTaskMessage({
    instructionPrefix: project.instructionPrefix,
    agentTail: project.agentTail,
    taskText: task.taskText,
  });
  await navigator.clipboard.writeText(msg);
  toast("Промпт скопирован в буфер", "ok");
}
