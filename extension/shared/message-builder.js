/** Соответствует prjcap.message_builder (Python). */

export const DEFAULT_AGENT_TAIL =
  "После выполнения: сделай коммит и `push` в репозиторий. " +
  "Затем кратко опиши результат, чтобы пользователь мог его проверить.";

/**
 * @param {{ instructionPrefix: string, taskText: string }} opts
 * @returns {string}
 */
export function buildTaskMessage({ instructionPrefix, taskText }) {
  const prefix = (instructionPrefix || "").trim();
  const task = (taskText || "").trim();
  const header = prefix ? prefix : "You are an AI agent.";
  return `${header}\n\nTASK:\n\n${task}\n\n${DEFAULT_AGENT_TAIL}\n`.trim() + "\n";
}
