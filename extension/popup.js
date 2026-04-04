import { buildTaskMessage } from "./shared/message-builder.js";

const STORAGE_KEYS = ["projects", "tasks", "lastProjectId"];

/** @typedef {{ id: string, name: string, chatUrl: string, instructionPrefix?: string, agentTail?: string, inputSelector?: string }} Project */
/** @typedef {{ id: string, projectId: string, taskText: string, status: 'open'|'sent'|'done', createdAt: string, sentAt?: string, doneAt?: string }} Task */

function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `id_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

async function loadState() {
  const d = await chrome.storage.local.get(STORAGE_KEYS);
  return {
    projects: Array.isArray(d.projects) ? d.projects : [],
    tasks: Array.isArray(d.tasks) ? d.tasks : [],
    lastProjectId: d.lastProjectId || null,
  };
}

async function saveState(partial) {
  await chrome.storage.local.set(partial);
}

const el = {
  projectSelect: /** @type {HTMLSelectElement} */ (document.getElementById("projectSelect")),
  btnOpenPaste: document.getElementById("btnOpenPaste"),
  btnOpenOnly: document.getElementById("btnOpenOnly"),
  btnCopyNext: document.getElementById("btnCopyNext"),
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
};

function setStatus(text, kind = "") {
  el.statusLine.textContent = text || "";
  el.statusLine.className = `status${kind ? ` ${kind}` : ""}`;
}

function selectedProjectId() {
  return el.projectSelect.value || null;
}

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

refresh();
