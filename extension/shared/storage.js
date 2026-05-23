/**
 * Shared storage utilities for prjcap extension.
 * Used by popup.js, timeline.js, and background.js.
 */

const STORAGE_KEYS = ["projects", "tasks", "recurring", "lastProjectId", "llm_settings", "assistant_history"];

/**
 * @typedef {{ id: string, name: string, chatUrl: string, color?: string, instructionPrefix?: string, agentTail?: string, inputSelector?: string }} Project
 * @typedef {{ id: string, projectId: string, taskText: string, status: 'open'|'sent'|'done', createdAt: string, sentAt?: string, doneAt?: string, scheduledDate?: string, scheduledTime?: string, duration?: number }} Task
 * @typedef {{ id: string, projectId: string, taskText: string, scheduledTime: string, duration: number, daysOfWeek: number[], enabled: boolean }} RecurringTask
 *   daysOfWeek: [0=Sun, 1=Mon, ..., 6=Sat]
 */

/** Generate a unique ID */
export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `id_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/** Load full state from chrome.storage.local */
export async function loadState() {
  const d = await chrome.storage.local.get(STORAGE_KEYS);
  return {
    projects: Array.isArray(d.projects) ? d.projects : [],
    tasks: Array.isArray(d.tasks) ? d.tasks : [],
    recurring: Array.isArray(d.recurring) ? d.recurring : [],
    lastProjectId: d.lastProjectId || null,
  };
}

/** Save partial state to chrome.storage.local */
export async function saveState(partial) {
  await chrome.storage.local.set(partial);
}

/** Load LLM settings from chrome.storage.local */
export async function loadLlmSettings() {
  const d = await chrome.storage.local.get('llm_settings');
  if (d.llm_settings) return d.llm_settings;
  // Return defaults without saving (lazy init)
  const { DEFAULT_LLM_SETTINGS } = await import('./llm.js');
  return { ...DEFAULT_LLM_SETTINGS };
}

/** Save LLM settings to chrome.storage.local */
export async function saveLlmSettings(settings) {
  await chrome.storage.local.set({ llm_settings: settings });
}

/** Load assistant chat history */
export async function loadAssistantHistory() {
  const d = await chrome.storage.local.get('assistant_history');
  return Array.isArray(d.assistant_history) ? d.assistant_history : [];
}

/** Save assistant chat history */
export async function saveAssistantHistory(history) {
  // Keep last 50 messages
  const trimmed = history.slice(-50);
  await chrome.storage.local.set({ assistant_history: trimmed });
}

export { STORAGE_KEYS };
