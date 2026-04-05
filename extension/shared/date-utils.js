/**
 * Shared date/time utilities for prjcap extension.
 * Used by popup.js, timeline modules, and background.js.
 */

/* ── Timeline constants ── */
export const SLOT_H = 48;
export const PER_HOUR = 4;
export const TOTAL_SLOTS = 24 * PER_HOUR;
export const SLOT_MIN = 15;

/* ── Russian locale ── */
export const MONTHS_RU = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];
export const DOW_RU = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

/** Format Date as YYYY-MM-DD */
export function fmtD(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Format date string "YYYY-MM-DD" as "5 апреля" */
export function fmtDateRu(ds) {
  const [, m, d] = ds.split("-").map(Number);
  return `${d} ${MONTHS_RU[m - 1]}`;
}

/** Get day of week name from date string "YYYY-MM-DD" */
export function dowRu(ds) {
  return DOW_RU[new Date(ds + "T00:00:00").getDay()];
}

/** Convert time string "HH:MM" to minutes from midnight. Returns -1 for falsy input. */
export function t2m(t) {
  if (!t) return -1;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/** Convert minutes from midnight to time string "HH:MM" */
export function m2t(m) {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Convert slot index to time string "HH:MM" */
export function slot2time(s) { return m2t(s * SLOT_MIN); }

/** Convert time string "HH:MM" to slot index */
export function time2slot(t) { return Math.floor(t2m(t) / SLOT_MIN); }

/** Get today's date as YYYY-MM-DD */
export function todayStr() {
  return fmtD(new Date());
}
