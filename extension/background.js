import { buildTaskMessage } from "./shared/message-builder.js";

/**
 * Выполняется в контексте страницы чата (без замыканий на модуль).
 * @param {string} text
 * @param {string | null} customSelector
 */
function pasteInjectFn(text, customSelector) {
  function visible(el) {
    const st = window.getComputedStyle(el);
    if (st.display === "none" || st.visibility === "hidden" || Number(st.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width >= 4 && r.height >= 4;
  }

  function isTextInput(el) {
    if (el.tagName === "TEXTAREA") return true;
    if (el.tagName !== "INPUT") return false;
    const t = (el.type || "text").toLowerCase();
    return t === "text" || t === "search" || t === "" || t === "url";
  }

  function fillNativeInput(el, t) {
    el.focus();
    try {
      const proto =
        el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, "value");
      if (desc && desc.set) desc.set.call(el, t);
      else el.value = t;
    } catch (_) {
      el.value = t;
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    try {
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: t }));
    } catch (_) {
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
    return true;
  }

  function fillEditable(el, t) {
    el.focus();
    if (document.execCommand) {
      try {
        if (document.execCommand("selectAll", false, null)) {
          document.execCommand("insertText", false, t);
          el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: t }));
          return true;
        }
      } catch (_) {}
    }
    el.textContent = t;
    try {
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: t }));
    } catch (_) {
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
    return true;
  }

  if (customSelector) {
    const el = document.querySelector(customSelector);
    if (el) {
      if (isTextInput(el) && fillNativeInput(el, text)) return { ok: true, via: "selector_input" };
      if ((el.isContentEditable || el.getAttribute("role") === "textbox") && fillEditable(el, text))
        return { ok: true, via: "selector_editable" };
      return { ok: false, error: "selector_not_fillable" };
    }
  }

  /** @type {{ el: Element, kind: string }[]} */
  const candidates = [];
  document.querySelectorAll("textarea").forEach((el) => {
    if (visible(el)) candidates.push({ el, kind: "textarea" });
  });
  document.querySelectorAll("input").forEach((el) => {
    if (isTextInput(el) && visible(el)) candidates.push({ el, kind: "input" });
  });
  document.querySelectorAll('[contenteditable="true"]').forEach((el) => {
    if (visible(el)) candidates.push({ el, kind: "editable" });
  });
  document.querySelectorAll('[role="textbox"]').forEach((el) => {
    if (visible(el) && !candidates.some((c) => c.el === el)) candidates.push({ el, kind: "textbox" });
  });

  function score(c) {
    const r = c.el.getBoundingClientRect();
    const cy = r.top + r.height / 2;
    const bottomBias = cy / Math.max(window.innerHeight, 1);
    let s = bottomBias * 180;
    if (c.kind === "textarea") s += 160;
    if (c.kind === "input") s += 40;
    if (c.kind === "editable") s += 80;
    if (c.kind === "textbox") s += 60;
    return s;
  }

  candidates.sort((a, b) => score(b) - score(a));

  for (const c of candidates) {
    if (c.kind === "textarea" || c.kind === "input") {
      if (fillNativeInput(/** @type {HTMLInputElement | HTMLTextAreaElement} */ (c.el), text))
        return { ok: true, via: c.kind };
    } else if (fillEditable(c.el, text)) {
      return { ok: true, via: c.kind };
    }
  }

  return { ok: false, error: "no_input_found" };
}

function waitTabComplete(tabId) {
  return new Promise((resolve) => {
    let done = false;
    function finish() {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    }
    function onUpdated(updatedId, info) {
      if (updatedId === tabId && info.status === "complete") finish();
    }
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.get(tabId).then((t) => {
      if (t.status === "complete") finish();
    });
  });
}

async function loadData() {
  const d = await chrome.storage.local.get(["projects", "tasks"]);
  return {
    projects: Array.isArray(d.projects) ? d.projects : [],
    tasks: Array.isArray(d.tasks) ? d.tasks : [],
  };
}

async function saveTasks(tasks) {
  await chrome.storage.local.set({ tasks });
}

/**
 * @param {string} projectId
 */
export async function openChatAndPasteNext(projectId) {
  const { projects, tasks } = await loadData();
  const project = projects.find((p) => String(p.id) === String(projectId));
  if (!project) return { ok: false, error: "Проект не найден." };

  const openTasks = tasks
    .filter((t) => String(t.projectId) === String(projectId) && t.status === "open")
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  if (openTasks.length === 0) return { ok: false, error: "Нет открытых задач в этом проекте." };

  const task = openTasks[0];
  const message = buildTaskMessage({
    instructionPrefix: project.instructionPrefix || "",
    agentTail: project.agentTail || "",
    taskText: task.taskText || "",
  });

  const tab = await chrome.tabs.create({ url: project.chatUrl, active: true });
  await waitTabComplete(tab.id);
  await new Promise((r) => setTimeout(r, 400));

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: pasteInjectFn,
    args: [message, project.inputSelector || null],
  });

  const injectResult = results && results[0] && results[0].result;
  const pasted = Boolean(injectResult && injectResult.ok);

  if (pasted) {
    const nextTasks = tasks.map((t) =>
      t.id === task.id ? { ...t, status: "sent", sentAt: new Date().toISOString() } : t
    );
    await saveTasks(nextTasks);
  }

  return {
    ok: true,
    pasted,
    inject: injectResult,
    message,
    taskId: task.id,
    tabId: tab.id,
  };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.action === "openChatAndPasteNext") {
    openChatAndPasteNext(msg.projectId)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: String(e && e.message ? e.message : e) }));
    return true;
  }
  return false;
});
