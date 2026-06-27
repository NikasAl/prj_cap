/**
 * @param {{ instructionPrefix?: string, agentTail?: string, taskText: string }} opts
 * @returns {string}
 */
export function buildTaskMessage({ instructionPrefix, agentTail, taskText }) {
  const prefix = (instructionPrefix || "").trim();
  const tail = (agentTail || "").trim();
  const task = (taskText || "").trim();

  if (!prefix && !tail) return task + "\n";

  const parts = [];
  if (prefix) parts.push(prefix);
  parts.push(task);
  if (tail) parts.push(tail);
  return parts.join("\n--\n").trimEnd() + "\n";
}
