/**
 * Keyboard navigation for the interactive dashboard.
 *
 * Served as a same-origin ES module (the CSP's `default-src 'self'` forbids
 * inline scripts) and loaded only in interactive mode. This is a progressive
 * enhancement: with JS disabled the dashboard stays fully usable through
 * native Tab focus, link activation, and the refresh form buttons.
 *
 * Keys (see HELP_ROWS): j/k or Up/Down move item focus within a panel,
 * h/l or Left/Right jump between panels (Tab keeps its native behavior),
 * Enter activates the focused link natively (so target/rel are respected),
 * r refreshes the focused panel through its existing refresh form, and
 * ? toggles a small help overlay (Escape closes it).
 *
 * Pure helpers are exported so the test suite can unit-test them without a
 * DOM; the event wiring at the bottom only runs in a real browser.
 */

/**
 * Move an index by delta within [0, length), clamping at the edges.
 * A current of -1 means "nothing focused yet": moving forward starts at the
 * first entry, moving backward at the last. Returns -1 when there is nothing
 * to focus.
 */
export function moveIndex(current, delta, length) {
  if (length <= 0) return -1;
  if (current < 0) return delta > 0 ? 0 : length - 1;
  return Math.min(length - 1, Math.max(0, current + delta));
}

/** True when the element is a text-entry target whose keystrokes we must not steal. */
export function isTypingTarget(el) {
  if (!el || typeof el.tagName !== "string") return false;
  const tag = el.tagName.toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return el.isContentEditable === true;
}

/** True when a keydown should be left entirely to the browser. */
export function shouldIgnoreKeydown(event) {
  return (
    event.defaultPrevented === true ||
    event.ctrlKey === true ||
    event.metaKey === true ||
    event.altKey === true ||
    isTypingTarget(event.target)
  );
}

/** Navigation table: key -> movement axis and direction. */
export const KEY_MOVES = {
  j: { axis: "item", delta: 1 },
  ArrowDown: { axis: "item", delta: 1 },
  k: { axis: "item", delta: -1 },
  ArrowUp: { axis: "item", delta: -1 },
  l: { axis: "panel", delta: 1 },
  ArrowRight: { axis: "panel", delta: 1 },
  h: { axis: "panel", delta: -1 },
  ArrowLeft: { axis: "panel", delta: -1 },
};

/**
 * Look up a key in KEY_MOVES. `key` is attacker-ish input (whatever the
 * keyboard reports), so guard with Object.hasOwn to keep Object.prototype
 * keys like "constructor" from matching.
 */
export function keyMove(key) {
  return Object.hasOwn(KEY_MOVES, key) ? KEY_MOVES[key] : null;
}

/** Rows for the help overlay: [keys, description]. */
export const HELP_ROWS = [
  ["j / k", "Next / previous item in the panel"],
  ["h / l", "Previous / next panel"],
  ["Tab", "Move through links and buttons"],
  ["Enter", "Open the focused item"],
  ["r", "Refresh the focused panel"],
  ["?", "Show or hide this help"],
  ["Esc", "Close this help"],
];

/* ------------------------------------------------------------------ */
/* DOM wiring (browser only)                                          */
/* ------------------------------------------------------------------ */

function reducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Focusable targets inside a panel: item links, else its refresh button. */
function focusTargets(panel) {
  const links = Array.from(panel.querySelectorAll(".panel-body .item-title a"));
  if (links.length > 0) return links;
  const refresh = panel.querySelector(".refresh-btn");
  return refresh ? [refresh] : [];
}

/** All panels that have at least one focusable target, in document order. */
function navigablePanels() {
  return Array.from(document.querySelectorAll(".panel")).filter(
    (panel) => focusTargets(panel).length > 0,
  );
}

function focusElement(el) {
  el.focus({ preventScroll: true });
  el.scrollIntoView({
    block: "nearest",
    inline: "nearest",
    behavior: reducedMotion() ? "auto" : "smooth",
  });
}

/** Locate the focused element within panels: { panelIndex, itemIndex }, -1s when outside. */
function currentPosition(panels) {
  const active = document.activeElement;
  if (!active) return { panelIndex: -1, itemIndex: -1 };
  const panel = active.closest ? active.closest(".panel") : null;
  const panelIndex = panel ? panels.indexOf(panel) : -1;
  if (panelIndex < 0) return { panelIndex: -1, itemIndex: -1 };
  return { panelIndex, itemIndex: focusTargets(panels[panelIndex]).indexOf(active) };
}

function moveFocus(move) {
  const panels = navigablePanels();
  if (panels.length === 0) return false;
  const pos = currentPosition(panels);

  if (move.axis === "panel" || pos.panelIndex < 0) {
    const delta = move.axis === "panel" ? move.delta : 1;
    const nextPanel = moveIndex(pos.panelIndex, delta, panels.length);
    if (nextPanel === pos.panelIndex) return true; // clamped at an edge
    focusElement(focusTargets(panels[nextPanel])[0]);
    return true;
  }

  const targets = focusTargets(panels[pos.panelIndex]);
  const next = moveIndex(pos.itemIndex, move.delta, targets.length);
  if (next >= 0 && next !== pos.itemIndex) focusElement(targets[next]);
  return true;
}

/** Submit the focused panel's refresh form (no-op when focus is outside a panel). */
function refreshFocusedPanel() {
  const active = document.activeElement;
  const panel = active && active.closest ? active.closest(".panel") : null;
  const button = panel ? panel.querySelector(".refresh-btn") : null;
  if (button) button.click();
}

let helpEl = null;
let helpReturnFocus = null;

function buildHelp() {
  const overlay = document.createElement("div");
  overlay.className = "kbd-help";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-label", "Keyboard shortcuts");
  overlay.tabIndex = -1;
  overlay.hidden = true;

  const close = document.createElement("button");
  close.type = "button";
  close.className = "kbd-help-close";
  close.setAttribute("aria-label", "Close keyboard shortcuts");
  close.textContent = "×";
  close.addEventListener("click", closeHelp);
  overlay.appendChild(close);

  const title = document.createElement("div");
  title.className = "kbd-help-title";
  title.textContent = "Keyboard shortcuts";
  overlay.appendChild(title);

  const list = document.createElement("dl");
  for (const [keys, description] of HELP_ROWS) {
    const dt = document.createElement("dt");
    const kbd = document.createElement("kbd");
    kbd.textContent = keys;
    dt.appendChild(kbd);
    const dd = document.createElement("dd");
    dd.textContent = description;
    list.appendChild(dt);
    list.appendChild(dd);
  }
  overlay.appendChild(list);

  document.body.appendChild(overlay);
  return overlay;
}

function helpOpen() {
  return helpEl !== null && !helpEl.hidden;
}

function openHelp() {
  if (helpEl === null) helpEl = buildHelp();
  helpReturnFocus = document.activeElement;
  helpEl.hidden = false;
  helpEl.focus();
}

function closeHelp() {
  if (!helpOpen()) return;
  helpEl.hidden = true;
  // Hand focus back to where the user was; the overlay is non-modal (no
  // focus trap), so this is a convenience rather than a requirement.
  if (helpReturnFocus && helpReturnFocus.isConnected) helpReturnFocus.focus();
  helpReturnFocus = null;
}

function onKeydown(event) {
  if (shouldIgnoreKeydown(event)) return;

  if (event.key === "?") {
    if (helpOpen()) closeHelp();
    else openHelp();
    event.preventDefault();
    return;
  }
  if (event.key === "Escape") {
    if (helpOpen()) {
      closeHelp();
      event.preventDefault();
    }
    return;
  }
  if (event.key === "r" && !event.shiftKey) {
    refreshFocusedPanel();
    return;
  }

  const move = keyMove(event.key);
  if (move === null || event.shiftKey) return;
  if (moveFocus(move)) event.preventDefault();
}

if (typeof document !== "undefined" && typeof window !== "undefined") {
  document.addEventListener("keydown", onKeydown);
}
