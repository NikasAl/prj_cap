/**
 * Timeline date navigation.
 * Moving between days, jumping to today, project filter.
 */
import { tl } from "./state.js";
import { loadAndRender, scrollToNow, renderCards, renderUnscheduled } from "./render.js";

export function navDate(delta) {
  tl.curDate.setDate(tl.curDate.getDate() + delta);
  loadAndRender();
}

export function goToday() {
  tl.curDate = new Date();
  loadAndRender();
  scrollToNow();
}

export function onFilterChange() {
  tl.filterPid = document.getElementById("projectFilter").value;
  renderCards();
  renderUnscheduled();
}
