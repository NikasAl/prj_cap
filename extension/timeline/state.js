/**
 * Timeline shared mutable state.
 * Central object for state accessed across all timeline modules.
 * Properties are mutable (object reference), so changes are visible to all importers.
 */
import { loadState, saveState } from "../shared/storage.js";
import { fmtD } from "../shared/date-utils.js";

/** @type {{ curDate: Date, filterPid: string, editId: string|null, dragId: string|null, projects: Project[], tasks: Task[] }} */
export const tl = {
  curDate: new Date(),
  filterPid: "",
  editId: null,
  dragId: null,
  projects: [],
  tasks: [],
};

/** Reload projects+tasks from storage into tl */
export async function reload() {
  const s = await loadState();
  tl.projects = s.projects;
  tl.tasks = s.tasks;
}

/** Persist tasks array to storage and update tl.tasks */
export async function persistTasks(tasks) {
  await saveState({ tasks });
  tl.tasks = tasks;
}

/** Current timeline date as YYYY-MM-DD */
export function dateStr() {
  return fmtD(tl.curDate);
}
