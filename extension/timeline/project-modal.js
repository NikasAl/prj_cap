/**
 * Timeline project modal — CRUD for projects on the timeline page.
 * Separated from task modal to keep concerns clean.
 */
import { uid } from "../shared/storage.js";
import { tl, reload, persistProjects, persistTasks } from "./state.js";
import { renderCards, renderUnscheduled, renderFilter } from "./render.js";
import { toast } from "./ui.js";
import { PROJECT_COLORS } from "../shared/colors.js";

const $ = (id) => document.getElementById(id);

let editingProjectId = null;
let selectedColor = null;

/* ── Color palette ── */

function renderColorPalette(activeColor) {
  const wrap = $("projColorPalette");
  wrap.innerHTML = "";
  selectedColor = activeColor || null;
  for (const c of PROJECT_COLORS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "color-swatch";
    btn.style.background = c;
    btn.title = c;
    if (c === activeColor) btn.classList.add("active");
    btn.addEventListener("click", () => {
      selectedColor = c;
      wrap.querySelectorAll(".color-swatch").forEach((s) => s.classList.remove("active"));
      btn.classList.add("active");
    });
    wrap.appendChild(btn);
  }
}

/* ── Open / Close ── */

export function openProjectModal(projectId = null) {
  editingProjectId = projectId || null;
  const title = $("projModalTitle");
  const btnDel = $("btnProjDelete");

  // Populate project selector for editing
  const editSel = $("projEditSelect");
  editSel.innerHTML = '<option value="">— создать новый —</option>';
  for (const p of tl.projects.sort((a, b) => a.name.localeCompare(b.name))) {
    const o = document.createElement("option");
    o.value = p.id;
    o.textContent = p.name;
    if (editingProjectId && p.id === editingProjectId) o.selected = true;
    editSel.appendChild(o);
  }

  if (editingProjectId) {
    title.textContent = "Редактировать проект";
    const p = tl.projects.find((x) => x.id === editingProjectId);
    if (!p) return;
    $("projName").value = p.name;
    $("projChatUrl").value = p.chatUrl;
    $("projPrefix").value = p.instructionPrefix || "";
    $("projTail").value = p.agentTail || "";
    $("projSelector").value = p.inputSelector || "";
    renderColorPalette(p.color || null);
    btnDel.classList.remove("hidden");
  } else {
    title.textContent = "Новый проект";
    $("projName").value = "";
    $("projChatUrl").value = "";
    $("projPrefix").value = "";
    $("projTail").value = "";
    $("projSelector").value = "textarea";
    renderColorPalette(null);
    btnDel.classList.add("hidden");
  }

  $("projectModalOverlay").classList.remove("hidden");
  $("projName").focus();
}

export function closeProjectModal() {
  $("projectModalOverlay").classList.add("hidden");
  editingProjectId = null;
}

/* ── Save ── */

export async function saveProject() {
  const name = $("projName").value.trim();
  const chatUrl = $("projChatUrl").value.trim();
  const instructionPrefix = $("projPrefix").value.trim();
  const agentTail = $("projTail").value.trim();
  const inputSelector = $("projSelector").value.trim();

  if (!name || !chatUrl) {
    toast("Нужны название и URL чата", "err");
    return;
  }

  let urlOk = true;
  try { new URL(chatUrl); } catch { urlOk = false; }
  if (!urlOk) {
    toast("Некорректный URL чата", "err");
    return;
  }

  await reload();

  const existing = editingProjectId
    ? tl.projects.find((p) => p.id === editingProjectId)
    : tl.projects.find((p) => p.name === name);

  const id = existing ? existing.id : uid();
  const project = {
    id,
    name,
    chatUrl,
    ...(selectedColor ? { color: selectedColor } : {}),
    ...(instructionPrefix ? { instructionPrefix } : {}),
    ...(agentTail ? { agentTail } : {}),
    ...(inputSelector ? { inputSelector } : {}),
  };
  const others = tl.projects.filter((p) => p.id !== id);
  await persistProjects([...others, project]);

  closeProjectModal();
  renderFilter();
  renderCards();
  renderUnscheduled();
  toast("Проект сохранён", "ok");
}

/* ── Delete ── */

export async function deleteProject() {
  if (!editingProjectId) return;
  const p = tl.projects.find((x) => x.id === editingProjectId);
  if (!p) return;
  if (!confirm(`Удалить проект «${p.name}» и все его задачи?`)) return;

  await reload();
  const projects = tl.projects.filter((x) => x.id !== editingProjectId);
  const tasks = tl.tasks.filter((t) => String(t.projectId) !== String(editingProjectId));

  // Also update tl.filterPid if it was this project
  if (String(tl.filterPid) === String(editingProjectId)) {
    tl.filterPid = "";
    const filterSel = document.getElementById("projectFilter");
    if (filterSel) filterSel.value = "";
  }

  await persistProjects(projects);
  await persistTasks(tasks);

  closeProjectModal();
  renderFilter();
  renderCards();
  renderUnscheduled();
  toast("Проект удалён", "ok");
}

/* ── Event wiring ── */

export function setupProjectModal() {
  $("btnProjSave").addEventListener("click", saveProject);
  $("btnProjDelete").addEventListener("click", deleteProject);
  $("btnProjCancel").addEventListener("click", closeProjectModal);

  // Switch between create/edit mode via selector
  $("projEditSelect").addEventListener("change", (e) => {
    const pid = e.target.value;
    if (pid) {
      openProjectModal(pid);
    } else {
      openProjectModal(null);
    }
  });

  $("projectModalOverlay").addEventListener("click", (e) => {
    if (e.target === $("projectModalOverlay")) closeProjectModal();
  });

  // Open project modal button in toolbar
  $("btnManageProjects").addEventListener("click", () => openProjectModal());
}
