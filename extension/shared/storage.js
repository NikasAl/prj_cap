/**
 * Shared storage utilities for prjcap extension.
 * Used by popup.js, timeline.js, and background.js.
 */

const STORAGE_KEYS = ["projects", "tasks", "recurring", "lastProjectId"];

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

export { STORAGE_KEYS };
