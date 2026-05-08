/**
 * Timeline shared mutable state.
 * Central object for state accessed across all timeline modules.
 * Properties are mutable (object reference), so changes are visible to all importers.
 */
import { loadState, saveState } from "../shared/storage.js";
import { fmtD } from "../shared/date-utils.js";

/** @type {{ curDate: Date, filterPid: string, editId: string|null, dragId: string|null, projects: Project[], tasks: Task[], recurring: RecurringTask[] }} */
export const tl = {
  curDate: new Date(),
  filterPid: "",
  editId: null,
  dragId: null,
  projects: [],
  tasks: [],
  recurring: [],
};

/** Reload projects+tasks+recurring from storage into tl */
export async function reload() {
  const s = await loadState();
  tl.projects = s.projects;
  tl.tasks = s.tasks;
  tl.recurring = s.recurring || [];
}

/** Persist tasks array to storage and update tl.tasks */
export async function persistTasks(tasks) {
  await saveState({ tasks });
  tl.tasks = tasks;
}

/** Persist projects array to storage and update tl.projects */
export async function persistProjects(projects) {
  await saveState({ projects });
  tl.projects = projects;
}

/** Persist recurring tasks array to storage and update tl.recurring */
export async function persistRecurring(recurring) {
  await saveState({ recurring });
  tl.recurring = recurring;
}

/** Current timeline date as YYYY-MM-DD */
export function dateStr() {
  return fmtD(tl.curDate);
}
