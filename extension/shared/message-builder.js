/** Соответствует prjcap.message_builder (Python). */

export const DEFAULT_AGENT_TAIL =
  "После выполнения: сделаем коммит и пуш в репозиторий.";

/**
 * @param {{ instructionPrefix?: string, agentTail?: string, taskText: string }} opts
 * @returns {string}
 */
export function buildTaskMessage({ instructionPrefix, agentTail, taskText }) {
  const prefix = (instructionPrefix || "").trim();
  const tail = (agentTail || "").trim();
  const task = (taskText || "").trim();
  const header = prefix ? prefix : "You are an AI agent.";
  const tailPart = tail ? tail : DEFAULT_AGENT_TAIL;
  return `${header}\n--\n${task}\n--\n${tailPart}\n`.trim() + "\n";
}
