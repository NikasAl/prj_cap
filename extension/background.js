import { buildTaskMessage } from "./shared/message-builder.js";
import { loadState, saveState, loadLlmSettings } from "./shared/storage.js";
import { chatCompletion } from "./shared/llm.js";

/* ══════════════════════════════════════════════════════════════
   Utility helpers
   ══════════════════════════════════════════════════════════════ */

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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
    function onUpdated(id, info) {
      if (id === tabId && info.status === "complete") finish();
    }
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.get(tabId).then((t) => {
      if (t.status === "complete") finish();
    });
  });
}

/**
 * Execute a function in a tab (MAIN world by default) with retry.
 */
async function execInTab(tabId, func, args = [], { world = "MAIN", retries = 2 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func,
        args,
        world,
      });
      return results?.[0]?.result ?? null;
    } catch (e) {
      const msg = e?.message || String(e);
      if (
        attempt < retries &&
        (msg.includes("Cannot access") || msg.includes("not found") || msg.includes("Receiving end does not exist"))
      ) {
        await sleep(1000);
        continue;
      }
      throw e;
    }
  }
  return null;
}

/* ══════════════════════════════════════════════════════════════
   Phase 1 — Inject text into chat textarea
   ══════════════════════════════════════════════════════════════ */

/**
 * Runs in the page (MAIN world).
 * Waits for #chat-input to appear, then injects text with multiple
 * event‑dispatch strategies to trigger Svelte reactivity.
 *
 * @param {string} text
 * @param {number} timeoutMs  max wait for textarea (ms)
 * @returns {Promise<{ok:boolean, error?:string, valueLength?:number, sendButtonEnabled?:boolean}>}
 */
function pageWaitAndInject(text, timeoutMs) {
  function doInject(ta) {
    ta.focus();

    /* 1) Native value setter (bypasses framework getter/setter traps) */
    const proto = window.HTMLTextAreaElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) {
      desc.set.call(ta, text);
    } else {
      ta.value = text;
    }

    /* 2) DOM events that Svelte / generic frameworks listen to */
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    ta.dispatchEvent(new Event("change", { bubbles: true }));

    /* 3) InputEvent with detailed fields */
    try {
      ta.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          cancelable: true,
          inputType: "insertText",
          data: text,
        })
      );
    } catch (_) {
      /* fallback already dispatched above */
    }

    /* 4) Keyboard‑like events (some frameworks react to these) */
    ta.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "a" }));
    ta.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "a" }));

    const sb = document.getElementById("send-message-button");
    return {
      ok: true,
      valueLength: ta.value.length,
      sendButtonEnabled: sb ? !sb.disabled : false,
    };
  }

  return new Promise((resolve) => {
    const ta = document.getElementById("chat-input");
    if (ta) return resolve(doInject(ta));

    const start = Date.now();
    const iv = setInterval(() => {
      const el = document.getElementById("chat-input");
      if (el) {
        clearInterval(iv);
        resolve(doInject(el));
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(iv);
        resolve({ ok: false, error: "#chat-input not found within " + timeoutMs + " ms" });
      }
    }, 500);
  });
}

/* ══════════════════════════════════════════════════════════════
   Phase 2a — Click send button
   ══════════════════════════════════════════════════════════════ */

/**
 * Runs in the page (MAIN world).
 * Clicks #send-message-button and reports whether a dialog appeared.
 */
function pageClickSend() {
  const btn = document.getElementById("send-message-button");
  if (!btn) return { ok: false, error: "send-message-button not found" };
  if (btn.disabled) return { ok: false, error: "send-message-button is disabled" };
  btn.click();

  /* Small delay for dialog to render, then check */
  return new Promise((resolve) => {
    setTimeout(() => {
      const dialog = _findBusyDialog();
      resolve({ ok: true, clicked: true, dialogFound: !!dialog });
    }, 1200);
  });
}

/* ══════════════════════════════════════════════════════════════
   Phase 2a — Detect / dismiss "system busy" dialog
   ══════════════════════════════════════════════════════════════ */

/** Generic dialog finder (page context) */
function _findBusyDialog() {
  return (
    document.querySelector('[role="dialog"]') ||
    document.querySelector('[role="alertdialog"]') ||
    document.querySelector('.fixed.inset-0.z-50') ||
    document.querySelector('[class*="modal-overlay"]') ||
    document.querySelector('[class*="dialog-overlay"]') ||
    document.querySelector('[data-state="open"][class*="dialog"]') ||
    null
  );
}

/**
 * Runs in the page. Clicks the cancel / close / dismiss button inside a dialog.
 */
function pageDismissDialog() {
  const dialog = _findBusyDialog();
  if (!dialog) return { ok: true, dismissed: false };

  /* Try several strategies to find the cancel button */
  const cancel =
    dialog.querySelector('button[class*="cancel"]') ||
    dialog.querySelector('button[class*="close"]') ||
    dialog.querySelector('button[aria-label*="ancel"]') ||
    dialog.querySelector('button[aria-label*="lose"]') ||
    dialog.querySelector("button");

  if (cancel) {
    cancel.click();
    return { ok: true, dismissed: true };
  }
  return { ok: false, dismissed: false, error: "no button in dialog" };
}

/* ══════════════════════════════════════════════════════════════
   Phase 2b — Get last user‑message ID (anchor for log extraction)
   ══════════════════════════════════════════════════════════════ */

function pageGetLastUserMessageId() {
  const msgs = document.querySelectorAll("div[id^='message-']");
  let lastUser = null;
  for (const m of msgs) {
    if (m.querySelector(".user-message") || m.classList.contains("user-message")) {
      lastUser = m;
    }
  }
  return lastUser ? lastUser.id : null;
}

/* ══════════════════════════════════════════════════════════════
   Phase 2b — Check if agent is still generating
   ══════════════════════════════════════════════════════════════ */

function pageIsAgentWorking() {
  /* Stop‑generating button (common pattern in LLM chats) */
  const stopBtn =
    document.querySelector("button[class*='stop']") ||
    document.querySelector("[class*='stop-generating']") ||
    document.querySelector("[aria-label*='Stop' i]") ||
    document.querySelector("[aria-label*='stop']");
  if (stopBtn && stopBtn.offsetParent !== null) return true;

  /* Streaming / typing indicator */
  const typing =
    document.querySelector("[class*='streaming']") ||
    document.querySelector("[class*='typing-indicator']") ||
    document.querySelector("[class*='cursor-blink']");
  if (typing && typing.offsetParent !== null) return true;

  /* If there is a visible response‑container that's still growing */
  const container = document.getElementById("response-content-container");
  if (container) {
    const children = container.children.length;
    /* If the container exists but has very little content, agent might still be starting */
    const lastP = container.querySelector("p:last-of-type");
    if (lastP && lastP.textContent.length < 5) return true;
  }

  return false;
}

/* ══════════════════════════════════════════════════════════════
   Phase 2b — Extract log text from chat
   ══════════════════════════════════════════════════════════════ */

/**
 * @param {string|null} afterMessageId  start AFTER this message
 */
function pageExtractLog(afterMessageId) {
  const msgs = document.querySelectorAll("div[id^='message-']");
  const parts = [];
  let found = false;

  for (const m of msgs) {
    if (!found) {
      if (m.id === afterMessageId) found = true;
      continue;
    }

    const isUser = m.classList.contains("user-message") || !!m.querySelector(".user-message");
    const isAssistant = !!m.querySelector(".chat-assistant");

    if (isUser) {
      /* User text is inside .bg-[#EAEAEA] (or dark variant) */
      const userContent =
        m.querySelector(".user-message [data-expanded] div[class*='rounded-xl']") ||
        m.querySelector(".user-message .chat-user");
      const txt = userContent ? (userContent.innerText || "").trim() : "(empty user)";
      parts.push({ role: "user", text: txt });
    } else if (isAssistant) {
      const asst = m.querySelector(".chat-assistant");
      const txt = asst ? (asst.innerText || "").trim() : "(empty assistant)";
      parts.push({ role: "assistant", text: txt });
    }
  }

  return {
    log: parts.map((p) => `[${p.role}]\n${p.text}`).join("\n\n---\n\n"),
    messageCount: parts.length,
    completed: !pageIsAgentWorking(),
  };
}

/* ══════════════════════════════════════════════════════════════
   Phase 2b — Persistent monitor (ISOLATED world → has chrome.*)
   ══════════════════════════════════════════════════════════════ */

/**
 * Injected in ISOLATED world so it can call chrome.runtime.sendMessage.
 * It polls the DOM to detect when the agent finishes, then sends the
 * collected log back to the background.
 *
 * All helper logic is duplicated here because ISOLATED world cannot
 * call functions defined in MAIN world.
 */
function pageMonitorAgent(taskId, startAfterMessageId, intervalMs) {
  /* ---- local copies of DOM helpers ---- */

  function isAgentWorking() {
    const stopBtn =
      document.querySelector("button[class*='stop']") ||
      document.querySelector("[class*='stop-generating']") ||
      document.querySelector("[aria-label*='Stop' i]");
    if (stopBtn && stopBtn.offsetParent !== null) return true;
    const typing = document.querySelector("[class*='streaming']");
    if (typing && typing.offsetParent !== null) return true;
    return false;
  }

  function extractLog(afterId) {
    const msgs = document.querySelectorAll("div[id^='message-']");
    const parts = [];
    let found = false;
    for (const m of msgs) {
      if (!found) {
        if (m.id === afterId) found = true;
        continue;
      }
      const isUser = m.classList.contains("user-message") || !!m.querySelector(".user-message");
      const isAssistant = !!m.querySelector(".chat-assistant");
      if (isUser) {
        const c =
          m.querySelector(".user-message [data-expanded] div[class*='rounded-xl']") ||
          m.querySelector(".user-message .chat-user");
        parts.push({ role: "user", text: c ? c.innerText.trim() : "(empty)" });
      } else if (isAssistant) {
        const c = m.querySelector(".chat-assistant");
        parts.push({ role: "assistant", text: c ? c.innerText.trim() : "(empty)" });
      }
    }
    return {
      log: parts.map((p) => `[${p.role}]\n${p.text}`).join("\n\n---\n\n"),
      messageCount: parts.length,
    };
  }

  /* ---- monitoring loop ---- */

  let stableCount = 0;
  const STABLE_NEEDED = 3; // 3 consecutive "not working" checks → done

  function tick() {
    const working = isAgentWorking();

    if (!working) {
      stableCount++;
      if (stableCount >= STABLE_NEEDED) {
        /* Agent finished — extract and report */
        const result = extractLog(startAfterMessageId);
        try {
          chrome.runtime.sendMessage({
            action: "agentTaskCompleted",
            taskId: taskId,
            log: result.log,
            messageCount: result.messageCount,
          });
        } catch (_) {
          /* extension context may have been invalidated */
        }
        return; // stop
      }
    } else {
      stableCount = 0;
    }

    setTimeout(tick, intervalMs);
  }

  /* First check after initial delay */
  setTimeout(tick, intervalMs);

  return { ok: true, monitoring: true, taskId, startAfterMessageId };
}

/* ══════════════════════════════════════════════════════════════
   Orchestration — open chat, inject, send, monitor
   ══════════════════════════════════════════════════════════════ */

/**
 * Full flow: open tab → inject text → click send → handle busy dialog → monitor.
 * Phase 1 + Phase 2 combined.
 *
 * @param {string} projectId
 * @returns {Promise<object>}
 */
export async function openChatAndSendNext(projectId) {
  const { projects, tasks } = await loadState();
  const project = projects.find((p) => String(p.id) === String(projectId));
  if (!project) return { ok: false, error: "Проект не найден." };

  const openTasks = tasks
    .filter((t) => String(t.projectId) === String(projectId) && t.status === "open")
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  if (openTasks.length === 0) return { ok: false, error: "Нет открытых задач." };

  const task = openTasks[0];
  const message = buildTaskMessage({
    instructionPrefix: project.instructionPrefix || "",
    agentTail: project.agentTail || "",
    taskText: task.taskText || "",
  });

  /* ── Open tab ── */
  const tab = await chrome.tabs.create({ url: project.chatUrl, active: true });
  await waitTabComplete(tab.id);
  await sleep(2000); // let SPA settle

  /* ── Phase 1: inject text with polling ── */
  const injectResult = await execInTab(tab.id, pageWaitAndInject, [message, 20000]);
  if (!injectResult || !injectResult.ok) {
    const errMsg = injectResult?.error || "injection failed";
    return { ok: true, pasted: false, inject: injectResult, message, taskId: task.id, tabId: tab.id, error: errMsg };
  }

  /* Mark task as sent */
  let currentTasks = tasks.map((t) =>
    t.id === task.id ? { ...t, status: "sent", sentAt: new Date().toISOString() } : t
  );
  await saveState({ tasks: currentTasks });

  /* ── Phase 2a: click send ── */
  await sleep(500);
  const sendResult = await execInTab(tab.id, pageClickSend);

  if (!sendResult || !sendResult.ok) {
    const err = sendResult?.error || "send click failed";
    return { ok: true, pasted: true, sent: false, sendError: err, message, taskId: task.id, tabId: tab.id };
  }

  /* ── Handle "system busy" dialog ── */
  if (sendResult.dialogFound) {
    await execInTab(tab.id, pageDismissDialog);
    const waitSec = Math.floor(Math.random() * 450) + 50; // 50…500 s
    console.log(`[prjcap] System busy — waiting ${waitSec}s before retry`);
    await sleep(waitSec * 1000);

    /* Re-inject text (the dialog dismiss may have cleared input) */
    await execInTab(tab.id, pageWaitAndInject, [message, 20000]);
    const retrySend = await execInTab(tab.id, pageClickSend);

    if (!retrySend?.ok || retrySend.dialogFound) {
      return { ok: true, pasted: true, sent: false, sendError: "still busy after retry", taskId: task.id, tabId: tab.id };
    }
  }

  /* Mark task as working */
  currentTasks = await loadState().then((s) =>
    s.tasks.map((t) => (t.id === task.id ? { ...t, status: "working" } : t))
  );
  await saveState({ tasks: currentTasks });

  /* ── Phase 2b: get anchor message ID & start monitor ── */
  await sleep(3000); // let the user message render in the log
  const anchorId = await execInTab(tab.id, pageGetLastUserMessageId);

  if (!anchorId) {
    return { ok: true, pasted: true, sent: true, monitored: false, error: "could not find user message in log", taskId: task.id, tabId: tab.id };
  }

  /* Inject persistent monitor (ISOLATED world → has chrome.runtime access) */
  const monResult = await execInTab(tab.id, pageMonitorAgent, [task.id, anchorId, 5000], { world: "ISOLATED" });

  return {
    ok: true,
    pasted: true,
    sent: true,
    monitored: !!monResult?.monitoring,
    anchorId,
    taskId: task.id,
    tabId: tab.id,
  };
}

/* ══════════════════════════════════════════════════════════════
   Legacy: open + paste only (no send/monitor)
   ══════════════════════════════════════════════════════════════ */

export async function openChatAndPasteNext(projectId) {
  const { projects, tasks } = await loadState();
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
  await sleep(2000);

  const injectResult = await execInTab(tab.id, pageWaitAndInject, [message, 20000]);
  const pasted = Boolean(injectResult && injectResult.ok);

  if (pasted) {
    const nextTasks = tasks.map((t) =>
      t.id === task.id ? { ...t, status: "sent", sentAt: new Date().toISOString() } : t
    );
    await saveState({ tasks: nextTasks });
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

/* ══════════════════════════════════════════════════════════════
   Handle monitor completion message
   ══════════════════════════════════════════════════════════════ */

async function handleAgentTaskCompleted(taskId, log, messageCount) {
  console.log(`[prjcap] Agent completed task ${taskId}, ${messageCount} messages in log`);

  const { tasks } = await loadState();
  const updated = tasks.map((t) =>
    t.id === taskId
      ? { ...t, status: "done", doneAt: new Date().toISOString(), agentLog: log }
      : t
  );
  await saveState({ tasks: updated });
}

/* ══════════════════════════════════════════════════════════════
   LLM chat handler
   ══════════════════════════════════════════════════════════════ */

async function handleLlmChat(payload) {
  try {
    const settings = await loadLlmSettings();
    const result = await chatCompletion(settings, {
      systemPrompt: payload.systemPrompt,
      userMessage: payload.userMessage,
    });
    return { success: true, data: result };
  } catch (err) {
    console.error("[prjcap] LLM request failed:", err.message);
    return { success: false, error: err.message };
  }
}

/* ══════════════════════════════════════════════════════════════
   Message router
   ══════════════════════════════════════════════════════════════ */

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.action === "openChatAndPasteNext") {
    openChatAndPasteNext(msg.projectId)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));
    return true;
  }

  if (msg?.action === "openChatAndSendNext") {
    openChatAndSendNext(msg.projectId)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));
    return true;
  }

  if (msg?.action === "agentTaskCompleted") {
    handleAgentTaskCompleted(msg.taskId, msg.log, msg.messageCount)
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));
    return true;
  }

  if (msg?.action === "LLM_CHAT") {
    handleLlmChat(msg.payload)
      .then(sendResponse)
      .catch((e) => sendResponse({ success: false, error: String(e?.message || e) }));
    return true;
  }

  return false;
});