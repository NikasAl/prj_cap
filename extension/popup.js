import { buildTaskMessage } from "./shared/message-builder.js";
import { uid, loadState, saveState } from "./shared/storage.js";
import { projColor } from "./shared/colors.js";
import { fmtD, todayStr, t2m } from "./shared/date-utils.js";

/** @typedef {{ id: string, name: string, chatUrl: string, instructionPrefix?: string, agentTail?: string, inputSelector?: string }} Project */
/** @typedef {{ id: string, projectId: string, taskText: string, status: 'open'|'sent'|'done', createdAt: string, sentAt?: string, doneAt?: string, scheduledDate?: string, scheduledTime?: string, duration?: number }} Task */

const el = {
  projectSelect: /** @type {HTMLSelectElement} */ (document.getElementById("projectSelect")),
  btnOpenPaste: document.getElementById("btnOpenPaste"),
  btnOpenOnly: document.getElementById("btnOpenOnly"),
  btnCopyNext: document.getElementById("btnCopyNext"),
  btnOpenTimeline: document.getElementById("btnOpenTimeline"),
  statusLine: document.getElementById("statusLine"),
  newTaskText: /** @type {HTMLTextAreaElement} */ (document.getElementById("newTaskText")),
  btnAddTask: document.getElementById("btnAddTask"),
  taskList: document.getElementById("taskList"),
  toggleProjectForm: document.getElementById("toggleProjectForm"),
  projectFormWrap: document.getElementById("projectFormWrap"),
  pfName: /** @type {HTMLInputElement} */ (document.getElementById("pfName")),
  pfChatUrl: /** @type {HTMLInputElement} */ (document.getElementById("pfChatUrl")),
  pfPrefix: /** @type {HTMLTextAreaElement} */ (document.getElementById("pfPrefix")),
  pfAgentTail: /** @type {HTMLTextAreaElement} */ (document.getElementById("pfAgentTail")),
  pfSelector: /** @type {HTMLInputElement} */ (document.getElementById("pfSelector")),
  btnSaveProject: document.getElementById("btnSaveProject"),
  btnDeleteProject: document.getElementById("btnDeleteProject"),
  feedList: document.getElementById("feedList"),
  feedCount: document.getElementById("feedCount"),
  feedEmpty: document.getElementById("feedEmpty"),
  toggleDataSection: document.getElementById("toggleDataSection"),
  dataSectionWrap: document.getElementById("dataSectionWrap"),
  btnExportData: document.getElementById("btnExportData"),
  btnImportData: document.getElementById("btnImportData"),
  importFileInput: /** @type {HTMLInputElement} */ (document.getElementById("importFileInput")),
};

/* ── Helpers ── */

function setStatus(text, kind = "") {
  el.statusLine.textContent = text || "";
  el.statusLine.className = `status${kind ? ` ${kind}` : ""}`;
}

function selectedProjectId() {
  return el.projectSelect.value || null;
}

/* colors and date utils imported from shared/ */

/** @param {Project[]} projects */
/** @param {Task[]} tasks */
function getNextOpenTask(projectId, tasks) {
  return tasks
    .filter((t) => String(t.projectId) === String(projectId) && t.status === "open")
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())[0];
}

/** @param {{ projects: Project[], tasks: Task[], lastProjectId: string | null }} state */
function fillProjectFormFromSelection(state) {
  const id = selectedProjectId();
  const p = state.projects.find((x) => String(x.id) === String(id));
  if (p) {
    el.pfName.value = p.name;
    el.pfChatUrl.value = p.chatUrl;
    el.pfPrefix.value = p.instructionPrefix || "";
    el.pfAgentTail.value = p.agentTail || "";
    el.pfSelector.value = p.inputSelector || "";
  } else {
    el.pfName.value = "";
    el.pfChatUrl.value = "";
    el.pfPrefix.value = "";
    el.pfSelector.value = "";
  }
}

/* ── Feed: today's scheduled tasks ── */

function renderFeed(state) {
  const ds = todayStr();
  const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();

  const scheduled = state.tasks
    .filter((t) => t.scheduledDate === ds && t.scheduledTime && t.status !== "done")
    .sort((a, b) => t2m(a.scheduledTime) - t2m(b.scheduledTime));

  el.feedCount.textContent = scheduled.length > 0 ? `(${scheduled.length})` : "";

  if (scheduled.length === 0) {
    el.feedList.innerHTML = "";
    el.feedEmpty.classList.remove("hidden");
    return;
  }

  el.feedEmpty.classList.add("hidden");
  el.feedList.innerHTML = "";

  // Find the next upcoming task
  let nextId = null;
  for (const t of scheduled) {
    const endMin = t2m(t.scheduledTime) + (t.duration || 1) * 15;
    if (endMin > nowMinutes) { nextId = t.id; break; }
  }

  for (const t of scheduled) {
    const li = document.createElement("li");
    const color = projColor(t.projectId);
    const proj = state.projects.find((p) => p.id === t.projectId);
    const isNext = t.id === nextId;
    li.className = `feed-item${isNext ? " feed-next" : ""}`;
    li.style.borderLeftColor = color;

    // Color bar
    const cBar = document.createElement("div");
    cBar.className = "feed-color";
    cBar.style.background = color;
    li.appendChild(cBar);

    // Body
    const body = document.createElement("div");
    body.className = "feed-body";
    const projSpan = document.createElement("div");
    projSpan.className = "feed-proj";
    projSpan.textContent = proj ? proj.name : "—";
    projSpan.style.color = color;
    body.appendChild(projSpan);
    const txtSpan = document.createElement("div");
    txtSpan.className = "feed-text";
    txtSpan.textContent = t.taskText;
    txtSpan.title = t.taskText;
    body.appendChild(txtSpan);
    li.appendChild(body);

    // Time
    const timeSpan = document.createElement("span");
    timeSpan.className = "feed-time";
    const endMin = t2m(t.scheduledTime) + (t.duration || 1) * 15;
    const endTime = `${String(Math.floor(endMin / 60) || 0).padStart(2, "0")}:${String(endMin % 60).padStart(2, "0")}`;
    timeSpan.textContent = `${t.scheduledTime}–${endTime}`;
    li.appendChild(timeSpan);

    el.feedList.appendChild(li);
  }
}

/* ── Main render ── */

/** @param {{ projects: Project[], tasks: Task[], lastProjectId: string | null }} state */
async function render(state) {
  const sel = selectedProjectId();
  el.projectSelect.innerHTML = "";
  if (state.projects.length === 0) {
    const o = document.createElement("option");
    o.value = "";
    o.textContent = "— добавьте проект ниже —";
    el.projectSelect.appendChild(o);
  } else {
    for (const p of [...state.projects].sort((a, b) => a.name.localeCompare(b.name))) {
      const o = document.createElement("option");
      o.value = p.id;
      o.textContent = p.name;
      el.projectSelect.appendChild(o);
    }
    let pick = sel && state.projects.some((p) => String(p.id) === String(sel)) ? sel : null;
    if (!pick && state.lastProjectId && state.projects.some((p) => String(p.id) === String(state.lastProjectId))) {
      pick = state.lastProjectId;
    }
    if (!pick && state.projects[0]) pick = state.projects[0].id;
    el.projectSelect.value = pick || "";
    await saveState({ lastProjectId: el.projectSelect.value || null });
  }

  fillProjectFormFromSelection(state);

  // Render feed
  renderFeed(state);

  const pid = selectedProjectId();
  el.taskList.innerHTML = "";
  if (!pid) return;

  const project = state.projects.find((p) => String(p.id) === String(pid));
  const list = state.tasks
    .filter((t) => String(t.projectId) === String(pid))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  for (const t of list) {
    const li = document.createElement("li");
    li.className = "task-item";
    const meta = document.createElement("div");
    meta.className = "task-meta";
    const badge = document.createElement("span");
    badge.className = `badge ${t.status}`;
    badge.textContent = t.status;
    const date = document.createElement("span");
    date.className = "muted";
    date.style.color = "#8b9cb3";
    date.style.fontSize = "11px";
    date.textContent = new Date(t.createdAt).toLocaleString();
    meta.appendChild(badge);
    meta.appendChild(date);
    const text = document.createElement("div");
    text.className = "task-text";
    text.textContent = t.taskText;
    li.appendChild(meta);
    li.appendChild(text);
    const actions = document.createElement("div");
    actions.className = "task-actions row gap";
    if (t.status !== "done") {
      const bDone = document.createElement("button");
      bDone.type = "button";
      bDone.className = "btn";
      bDone.textContent = "Готово";
      bDone.addEventListener("click", () => markDone(t.id));
      actions.appendChild(bDone);
    }
    if (t.status === "open") {
      const bCopy = document.createElement("button");
      bCopy.type = "button";
      bCopy.className = "btn";
      bCopy.textContent = "Копировать сообщение";
      bCopy.addEventListener("click", async () => {
        if (!project) return;
        const msg = buildTaskMessage({
          instructionPrefix: project.instructionPrefix,
          agentTail: project.agentTail,
          taskText: t.taskText,
        });
        await navigator.clipboard.writeText(msg);
        setStatus("Сообщение скопировано в буфер.", "ok");
      });
      actions.appendChild(bCopy);
    }

    // Кнопка редактирования для open и sent задач
    if (t.status === "open" || t.status === "sent") {
      const bEdit = document.createElement("button");
      bEdit.type = "button";
      bEdit.className = "btn";
      bEdit.textContent = "Изменить";
      bEdit.addEventListener("click", () => {
        startEditTask(t.id, t.taskText, li);
      });
      actions.appendChild(bEdit);
    }
    li.appendChild(actions);
    el.taskList.appendChild(li);
  }
}

async function refresh() {
  const state = await loadState();
  await render(state);
}

async function markDone(taskId) {
  const state = await loadState();
  const tasks = state.tasks.map((t) =>
    t.id === taskId ? { ...t, status: "done", doneAt: new Date().toISOString() } : t
  );
  await saveState({ tasks });
  await refresh();
  setStatus("Задача отмечена выполненной.", "ok");
}

/** Перевод задачи в режим редактирования */
function startEditTask(taskId, currentText, taskItemEl) {
  const textDiv = taskItemEl.querySelector(".task-text");
  if (!textDiv) return;

  // Удаляем предыдущие режимы редактирования
  const existingEdit = taskItemEl.querySelector(".task-edit-wrap");
  if (existingEdit) existingEdit.remove();

  const wrap = document.createElement("div");
  wrap.className = "task-edit-wrap";

  const textarea = document.createElement("textarea");
  textarea.className = "ctl area";
  textarea.value = currentText;
  textarea.style.marginBottom = "8px";

  const btnSave = document.createElement("button");
  btnSave.type = "button";
  btnSave.className = "btn primary";
  btnSave.textContent = "Сохранить";
  btnSave.style.minWidth = "100px";
  btnSave.addEventListener("click", async () => {
    const newText = textarea.value.trim();
    if (!newText) {
      setStatus("Текст задачи не может быть пустым.", "err");
      return;
    }
    const state = await loadState();
    const tasks = state.tasks.map((t) =>
      t.id === taskId ? { ...t, taskText: newText } : t
    );
    await saveState({ tasks });
    await refresh();
    setStatus("Задача обновлена.", "ok");
  });

  const btnCancel = document.createElement("button");
  btnCancel.type = "button";
  btnCancel.className = "btn";
  btnCancel.textContent = "Отмена";
  btnCancel.style.minWidth = "80px";
  btnCancel.addEventListener("click", () => {
    wrap.remove();
    textDiv.style.display = "";
  });

  const btnRow = document.createElement("div");
  btnRow.className = "row gap";
  btnRow.appendChild(btnSave);
  btnRow.appendChild(btnCancel);

  wrap.appendChild(textarea);
  wrap.appendChild(btnRow);

  textDiv.style.display = "none";
  taskItemEl.insertBefore(wrap, taskItemEl.querySelector(".task-actions"));
  textarea.focus();
}

/* ── Event listeners ── */

el.projectSelect.addEventListener("change", async () => {
  await saveState({ lastProjectId: selectedProjectId() });
  const state = await loadState();
  await render(state);
  setStatus("");
});

el.btnAddTask.addEventListener("click", async () => {
  const pid = selectedProjectId();
  const text = el.newTaskText.value.trim();
  if (!pid) {
    setStatus("Выберите или создайте проект.", "err");
    return;
  }
  if (!text) {
    setStatus("Введите текст задачи.", "err");
    return;
  }
  const state = await loadState();
  const task = {
    id: uid(),
    projectId: pid,
    taskText: text,
    status: "open",
    createdAt: new Date().toISOString(),
  };
  await saveState({ tasks: [...state.tasks, task] });
  el.newTaskText.value = "";
  await refresh();
  setStatus("Задача добавлена.", "ok");
});

el.btnSaveProject.addEventListener("click", async () => {
  const name = el.pfName.value.trim();
  const chatUrl = el.pfChatUrl.value.trim();
  const instructionPrefix = el.pfPrefix.value.trim();
  const agentTail = el.pfAgentTail.value.trim();
  const inputSelector = el.pfSelector.value.trim();
  if (!name || !chatUrl) {
    setStatus("Нужны название и URL чата.", "err");
    return;
  }
  let urlOk = true;
  try {
    new URL(chatUrl);
  } catch {
    urlOk = false;
  }
  if (!urlOk) {
    setStatus("Некорректный URL чата.", "err");
    return;
  }

  const state = await loadState();
  const existing = state.projects.find((p) => p.name === name);
  const id = existing ? existing.id : uid();
  const project = {
    id,
    name,
    chatUrl,
    ...(instructionPrefix ? { instructionPrefix } : {}),
    ...(agentTail ? { agentTail } : {}),
    ...(inputSelector ? { inputSelector } : {}),
  };
  const others = state.projects.filter((p) => p.id !== id);
  await saveState({ projects: [...others, project], lastProjectId: id });
  await refresh();
  el.projectSelect.value = id;
  setStatus("Проект сохранён.", "ok");
});

el.btnDeleteProject.addEventListener("click", async () => {
  const pid = selectedProjectId();
  if (!pid) return;
  const state = await loadState();
  const p = state.projects.find((x) => String(x.id) === String(pid));
  if (!p) return;
  if (!confirm(`Удалить проект «${p.name}» и все его задачи?`)) return;
  const projects = state.projects.filter((x) => x.id !== pid);
  const tasks = state.tasks.filter((t) => String(t.projectId) !== String(pid));
  await saveState({
    projects,
    tasks,
    lastProjectId: projects[0] ? projects[0].id : null,
  });
  await refresh();
  setStatus("Проект удалён.", "ok");
});

el.btnOpenOnly.addEventListener("click", async () => {
  const pid = selectedProjectId();
  if (!pid) {
    setStatus("Выберите проект.", "err");
    return;
  }
  const state = await loadState();
  const p = state.projects.find((x) => String(x.id) === String(pid));
  if (!p) return;
  await chrome.tabs.create({ url: p.chatUrl, active: true });
  setStatus("Вкладка открыта.", "ok");
});

el.btnCopyNext.addEventListener("click", async () => {
  const pid = selectedProjectId();
  if (!pid) {
    setStatus("Выберите проект.", "err");
    return;
  }
  const state = await loadState();
  const project = state.projects.find((x) => String(x.id) === String(pid));
  if (!project) return;
  const next = getNextOpenTask(pid, state.tasks);
  if (!next) {
    setStatus("Нет открытых задач.", "err");
    return;
  }
  const msg = buildTaskMessage({
    instructionPrefix: project.instructionPrefix,
    agentTail: project.agentTail,
    taskText: next.taskText,
  });
  await navigator.clipboard.writeText(msg);
  setStatus("Текст следующей задачи скопирован (с постоянным промптом).", "ok");
});

el.btnOpenPaste.addEventListener("click", async () => {
  const pid = selectedProjectId();
  if (!pid) {
    setStatus("Выберите проект.", "err");
    return;
  }
  setStatus("Открываю чат…");
  try {
    const res = await chrome.runtime.sendMessage({ action: "openChatAndPasteNext", projectId: pid });
    if (!res || !res.ok) {
      setStatus((res && res.error) || "Ошибка.", "err");
      return;
    }
    if (res.pasted) {
      setStatus("Чат открыт, текст вставлен в поле. Задача помечена как «отправлена».", "ok");
    } else {
      const hint = res.inject && res.inject.error ? ` (${res.inject.error})` : "";
      setStatus(
        `Чат открыт. Автовставка не сработала${hint}. Сообщение скопировано в буфер — вставьте вручную.`,
        "ok"
      );
      if (res.message) await navigator.clipboard.writeText(res.message);
    }
    await refresh();
  } catch (e) {
    setStatus(String(e && e.message ? e.message : e), "err");
  }
});

el.toggleProjectForm.addEventListener("click", () => {
  const open = el.projectFormWrap.classList.toggle("hidden") === false;
  el.toggleProjectForm.setAttribute("aria-expanded", open ? "true" : "false");
});

/* ── Data import / export ── */

const EXPORT_VERSION = 1;

el.toggleDataSection.addEventListener("click", () => {
  const open = el.dataSectionWrap.classList.toggle("hidden") === false;
  el.toggleDataSection.setAttribute("aria-expanded", open ? "true" : "false");
});

el.btnExportData.addEventListener("click", async () => {
  const state = await loadState();
  const payload = {
    _version: EXPORT_VERSION,
    _exportedAt: new Date().toISOString(),
    projects: state.projects,
    tasks: state.tasks,
  };
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `prjcap-backup-${fmtD(new Date())}.json`;
  a.click();
  URL.revokeObjectURL(url);
  setStatus(`Экспорт: ${state.projects.length} проектов, ${state.tasks.length} задач.`, "ok");
});

el.btnImportData.addEventListener("click", () => {
  el.importFileInput.click();
});

el.importFileInput.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  el.importFileInput.value = ""; // reset so same file can be re-imported

  try {
    const text = await file.text();
    const data = JSON.parse(text);

    if (!Array.isArray(data.projects) || !Array.isArray(data.tasks)) {
      setStatus("Неверный формат файла: отсутствуют projects или tasks.", "err");
      return;
    }

    const state = await loadState();

    // Build existing ID sets to avoid duplicates
    const existingProjectIds = new Set(state.projects.map((p) => p.id));
    const existingTaskIds = new Set(state.tasks.map((t) => t.id));

    let addedProjects = 0;
    let addedTasks = 0;

    // Add projects that don't exist yet (match by id or by name+url)
    for (const p of data.projects) {
      if (!p.id || !p.name) continue;
      const existsById = existingProjectIds.has(p.id);
      const existsByName = state.projects.some(
        (ep) => ep.name === p.name && ep.chatUrl === p.chatUrl
      );
      if (!existsById && !existsByName) {
        state.projects.push(p);
        existingProjectIds.add(p.id);
        addedProjects++;
      }
    }

    // Add tasks that don't exist yet (by id)
    for (const t of data.tasks) {
      if (!t.id || !t.taskText) continue;
      if (existingTaskIds.has(t.id)) continue;
      // Only import if project exists (in current or just imported)
      if (!existingProjectIds.has(t.projectId)) continue;
      state.tasks.push(t);
      existingTaskIds.add(t.id);
      addedTasks++;
    }

    await saveState({ projects: state.projects, tasks: state.tasks });
    await refresh();
    setStatus(`Импорт: +${addedProjects} проектов, +${addedTasks} задач.`, "ok");
  } catch (err) {
    setStatus("Ошибка импорта: " + (err.message || err), "err");
  }
});

// Open timeline page
el.btnOpenTimeline.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("timeline.html") });
  window.close(); // close popup after opening
});

// Re-render when storage changes (sync with timeline page)
chrome.storage.onChanged.addListener((changes) => {
  if (changes.tasks || changes.projects) {
    refresh();
  }
});

refresh();
