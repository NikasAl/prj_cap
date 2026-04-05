/**
 * Timeline app — initialization, event wiring, keyboard shortcuts.
 * Entry point for timeline.html.
 */
import { loadAndRender, buildTimeLabels, buildSlotGrid, updateNowLine, scrollToNow } from "./render.js";
import { navDate, goToday, onFilterChange } from "./date-nav.js";
import { setupCardDragDelegation, setupTimelineDrop, setupSidebarDrop, setupDayDrop } from "./drag-drop.js";
import { setupModalDelegation, closeModal, openModal } from "./modal.js";
import { initVoiceInput, toggleRecording } from "./voice.js";

const $ = (id) => document.getElementById(id);

function init() {
  // Navigation
  $("btnPrevDay").addEventListener("click", () => navDate(-1));
  $("btnNextDay").addEventListener("click", () => navDate(1));
  $("btnToday").addEventListener("click", goToday);
  $("projectFilter").addEventListener("change", onFilterChange);
  $("btnAddTask").addEventListener("click", () => openModal("add"));

  // Drag & drop
  setupCardDragDelegation();
  setupTimelineDrop();
  setupSidebarDrop();
  setupDayDrop($("btnPrevDay"), -1);
  setupDayDrop($("btnNextDay"), 1);

  // Modal event delegation (card clicks, slot dblclick, modal buttons)
  setupModalDelegation();

  // Voice input
  initVoiceInput();

  // Build static grid
  buildTimeLabels();
  buildSlotGrid();

  // Keyboard shortcuts
  document.addEventListener("keydown", (e) => {
    if ($("modalOverlay").classList.contains("hidden")) {
      if (e.key === "ArrowLeft") navDate(-1);
      if (e.key === "ArrowRight") navDate(1);
      if (e.key === "t" || e.key === "T" || e.key === "з" || e.key === "З") goToday();
    } else {
      if (e.key === "Escape") closeModal();
      // Voice dictation: Ctrl+' (or Ctrl+э in Russian layout)
      if ((e.ctrlKey || e.metaKey) && (e.key === "э" || e.key === "'")) {
        e.preventDefault();
        toggleRecording();
      }
    }
  });

  // Sidebar resize
  initSidebarResize();

  // Initial render
  loadAndRender().then(scrollToNow);

  // Periodic now-line update
  setInterval(updateNowLine, 30000);

  // Sync with storage changes from popup / background
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.projects || changes.tasks) loadAndRender();
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
