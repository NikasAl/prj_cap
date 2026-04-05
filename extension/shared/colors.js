/**
 * Shared color utilities for prjcap extension.
 * Used by popup.js and timeline modules.
 */

export const PROJECT_COLORS = [
  "#3d8bfd", "#3ecf8e", "#ff9f43", "#ee5a6f", "#a78bfa",
  "#22d3ee", "#f472b6", "#84cc16", "#fbbf24", "#6366f1",
];

/** Simple string hash for deterministic color assignment */
export function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return h;
}

/** Get color for a project by its ID */
export function projColor(pid) {
  return PROJECT_COLORS[Math.abs(hashStr(pid || "")) % PROJECT_COLORS.length];
}

/** Convert hex color to rgba string */
export function hexRgba(hex, a) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}
