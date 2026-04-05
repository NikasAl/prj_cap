/**
 * Timeline UI utility — toast notifications.
 */
let _timer = null;

export function toast(msg, kind = "ok") {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = `toast ${kind} visible`;
  clearTimeout(_timer);
  _timer = setTimeout(() => (el.className = "toast hidden"), 2200);
}
