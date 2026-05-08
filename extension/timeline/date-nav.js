/**
 * Timeline date navigation.
 * Moving between days, jumping to today, project filter.
 */
import { tl, dateStr } from "./state.js";
import { loadAndRender, scrollToNow, renderCards, renderUnscheduled } from "./render.js";
import { spawnRecurringForDate } from "./recurring.js";

export async function navDate(delta) {
  tl.curDate.setDate(tl.curDate.getDate() + delta);
  const ds = dateStr();
  await spawnRecurringForDate(ds);
  loadAndRender();
}

export async function goToday() {
  tl.curDate = new Date();
  const ds = dateStr();
  await spawnRecurringForDate(ds);
  loadAndRender();
  scrollToNow();
}

export function onFilterChange() {
  tl.filterPid = document.getElementById("projectFilter").value;
  renderCards();
  renderUnscheduled();
}
