/**
 * AI Assistant chat panel for prjcap timeline.
 * Provides a floating chat UI that communicates with LLM via background service worker.
 */
import { tl, reload } from "./state.js";
import { loadAssistantHistory, saveAssistantHistory, loadLlmSettings } from "../shared/storage.js";
import { getActiveModelId } from "../shared/llm.js";
import { fmtD } from "../shared/date-utils.js";
import { toast } from "./ui.js";
import { projColor } from "../shared/colors.js";

/* ── State ── */

/** @type {Array<{role: string, content: string}>} */
let history = [];
let isOpen = false;
let isLoading = false;

/* ── DOM refs ── */

let panel, messagesEl, inputEl, sendBtn, typingEl, emptyEl, toggleBtn;

/* ── Public API ── */

export function initAssistant() {
  createToggle();
  createPanel();
  loadHistory();
  bindEvents();
}

export function toggleAssistant() {
  if (isOpen) closePanel();
  else openPanel();
}

/** Check if assistant is currently open */
export function isAssistantOpen() {
  return isOpen;
}

/* ── Create DOM ── */

function createToggle() {
  toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'assistant-toggle';
  toggleBtn.title = 'AI-ассистент (Ctrl+Shift+A)';
  toggleBtn.textContent = '\u{1F916}'; // robot emoji
  toggleBtn.addEventListener('click', toggleAssistant);
  document.body.appendChild(toggleBtn);
}

function createPanel() {
  panel = document.createElement('div');
  panel.className = 'assistant-panel';
  panel.innerHTML = `
    <div class="assistant-resize" title="Перетащите для изменения размера"></div>
    <div class="assistant-hdr">
      <div class="assistant-hdr-title"><span class="ai-dot"></span> AI-ассистент</div>
      <button type="button" class="assistant-hdr-btn" id="asstBtnClear" title="Очистить историю">\u{1F5D1}</button>
      <button type="button" class="assistant-hdr-btn" id="asstBtnClose" title="Закрыть">\u2715</button>
    </div>
    <div class="assistant-messages" id="asstMessages"></div>
    <div class="assistant-input">
      <textarea id="asstInput" rows="1" placeholder="Спросите что-нибудь о задачах..."></textarea>
      <button type="button" class="assistant-send" id="asstSend" title="Отправить (Enter)">&#10148;</button>
    </div>
  `;
  document.body.appendChild(panel);

  messagesEl = panel.querySelector('#asstMessages');
  inputEl = panel.querySelector('#asstInput');
  sendBtn = panel.querySelector('#asstSend');

  panel.querySelector('#asstBtnClose').addEventListener('click', closePanel);
  panel.querySelector('#asstBtnClear').addEventListener('click', clearHistory);

  initResize();
}

/* ── Resize ── */

function initResize() {
  const handle = panel.querySelector('.assistant-resize');
  if (!handle) return;

  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    handle.classList.add('active');
    const startY = e.clientY;
    const startH = panel.offsetHeight;
    const maxH = window.innerHeight * 0.85;

    function onMove(e2) {
      const newH = Math.max(280, Math.min(maxH, startH + (startY - e2.clientY)));
      panel.style.height = `${newH}px`;
    }
    function onUp() {
      handle.classList.remove('active');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    }
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'ns-resize';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

/* ── Open / Close ── */

function openPanel() {
  isOpen = true;
  panel.classList.add('open');
  toggleBtn.classList.add('active');
  inputEl.focus();
  renderMessages();
}

function closePanel() {
  isOpen = false;
  panel.classList.remove('open');
  toggleBtn.classList.remove('active');
}

/* ── Events ── */

function bindEvents() {
  sendBtn.addEventListener('click', handleSend);

  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  // Auto-resize textarea
  inputEl.addEventListener('input', () => {
    inputEl.style.height = 'auto';
    inputEl.style.height = `${Math.min(inputEl.scrollHeight, 100)}px`;
  });
}

/* ── Send message ── */

async function handleSend() {
  const text = inputEl.value.trim();
  if (!text || isLoading) return;

  inputEl.value = '';
  inputEl.style.height = 'auto';

  // Add user message
  history.push({ role: 'user', content: text });
  renderMessages();

  // Show typing indicator
  isLoading = true;
  sendBtn.disabled = true;
  showTyping(true);

  try {
    const systemPrompt = buildSystemPrompt();
    const response = await chrome.runtime.sendMessage({
      action: 'LLM_CHAT',
      payload: { systemPrompt, userMessage: text },
    });

    if (!response || !response.success) {
      const errMsg = response?.error || 'Неизвестная ошибка';
      history.push({ role: 'error', content: errMsg });
      toast('Ошибка AI: ' + errMsg, 'err');
    } else {
      history.push({ role: 'assistant', content: response.data });
    }
  } catch (err) {
    const msg = err?.message || String(err);
    history.push({ role: 'error', content: msg });
    toast('Ошибка: ' + msg, 'err');
  } finally {
    isLoading = false;
    sendBtn.disabled = false;
    showTyping(false);
    renderMessages();
    await saveHistory();
  }
}

/* ── System prompt builder ── */

function buildSystemPrompt() {
  const today = fmtD(tl.curDate);
  const now = new Date();
  const timeStr = now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

  // Projects summary
  const projectsInfo = tl.projects.map(p => {
    const pTasks = tl.tasks.filter(t => String(t.projectId) === String(p.id));
    const open = pTasks.filter(t => t.status === 'open').length;
    const sent = pTasks.filter(t => t.status === 'sent').length;
    const done = pTasks.filter(t => t.status === 'done').length;
    const total = pTasks.length;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    return `- ${p.name} (${pct}% выполнено): ${open} открытых, ${sent} отправленных, ${done} выполненных из ${total}`;
  }).join('\n');

  // Tasks scheduled for today
  const todayTasks = tl.tasks
    .filter(t => t.scheduledDate === today && t.status !== 'done')
    .sort((a, b) => (a.scheduledTime || '').localeCompare(b.scheduledTime || ''))
    .map(t => {
      const proj = tl.projects.find(p => p.id === t.projectId);
      const time = t.scheduledTime || 'не задано';
      const dur = t.duration ? `${t.duration * 15} мин` : '';
      const status = t.status === 'sent' ? '[отправлено]' : '[открыто]';
      return `  ${time} ${dur ? '(' + dur + ')' : ''} — ${proj ? proj.name + ': ' : ''}${t.taskText} ${status}`;
    });

  // Unscheduled open tasks
  const unscheduledTasks = tl.tasks
    .filter(t => !t.scheduledDate && t.status === 'open')
    .map(t => {
      const proj = tl.projects.find(p => p.id === t.projectId);
      return `  - ${proj ? proj.name + ': ' : ''}${t.taskText}`;
    });

  // Recently completed (last 7 days)
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const recentDone = tl.tasks
    .filter(t => t.status === 'done' && t.doneAt && new Date(t.doneAt) >= weekAgo)
    .sort((a, b) => new Date(b.doneAt).getTime() - new Date(a.doneAt).getTime())
    .slice(0, 15)
    .map(t => {
      const proj = tl.projects.find(p => p.id === t.projectId);
      const date = new Date(t.doneAt).toLocaleDateString('ru-RU');
      return `  + [${date}] ${proj ? proj.name + ': ' : ''}${t.taskText}`;
    });

  let prompt = `Ты — AI-ассистент по управлению проектами и задачами в приложении prjcap.
Твоя задача — помогать пользователю планировать день, приоритизировать задачи, анализировать прогресс и уточнять цели проектов.

Текущая дата и время: ${today}, ${timeStr}.

=== ПРОЕКТЫ ===
${projectsInfo || 'Нет проектов.'}

=== ЗАДАЧИ НА СЕГОДНЯ (${today}) ===
${todayTasks.length > 0 ? todayTasks.join('\n') : 'Нет запланированных задач на сегодня.'}

=== НЕРАСПРЕДЕЛЁННЫЕ ЗАДАЧИ (открытые, без даты) ===
${unscheduledTasks.length > 0 ? unscheduledTasks.join('\n') : 'Нет нераспределённых задач.'}

=== ВЫПОЛНЕННОЕ ЗА ПОСЛЕДНЮЮ НЕДЕЛЮ ===
${recentDone.length > 0 ? recentDone.join('\n') : 'Нет выполненных задач за неделю.'}

=== ИНСТРУКЦИИ ===
- Отвечай на русском языке, кратко и по делу.
- Предлагай конкретные действия и расписание, если спрашивают о планировании.
- Если проекту не хватает описания целей или критериев завершения — задавай уточняющие вопросы.
- Помогай определить приоритеты на основе объёма задач и дедлайнов.
- Считай статистику прогресса, если просят анализ.
- Не придумывай задачи, которых нет в списке — работай только с реальными данными.`;

  return prompt;
}

/* ── Render messages ── */

function renderMessages() {
  if (!messagesEl) return;
  messagesEl.innerHTML = '';

  if (history.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'asst-empty';
    empty.textContent = 'Задайте вопрос о ваших задачах, проектах или планировании дня.';
    messagesEl.appendChild(empty);
    return;
  }

  for (const msg of history) {
    const bubble = document.createElement('div');
    if (msg.role === 'user') {
      bubble.className = 'asst-msg asst-msg-user';
      bubble.textContent = msg.content;
    } else if (msg.role === 'error') {
      bubble.className = 'asst-msg asst-msg-error';
      bubble.textContent = msg.content;
    } else {
      bubble.className = 'asst-msg asst-msg-ai';
      bubble.textContent = msg.content;
    }
    messagesEl.appendChild(bubble);
  }

  scrollToBottom();
}

function scrollToBottom() {
  if (messagesEl) {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
}

function showTyping(show) {
  if (!messagesEl) return;
  const existing = messagesEl.querySelector('.asst-typing');
  if (show && !existing) {
    const el = document.createElement('div');
    el.className = 'asst-typing';
    el.innerHTML = '<span class="asst-typing-dot"></span><span class="asst-typing-dot"></span><span class="asst-typing-dot"></span>';
    messagesEl.appendChild(el);
    scrollToBottom();
  } else if (!show && existing) {
    existing.remove();
  }
}

/* ── History persistence ── */

async function loadHistory() {
  history = await loadAssistantHistory();
}

async function saveHistory() {
  await saveAssistantHistory(history);
}

async function clearHistory() {
  history = [];
  await saveHistory();
  renderMessages();
  toast('История чата очищена', 'ok');
}
