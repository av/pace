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
 * r refreshes the focused panel through its existing refresh form,
 * c collapses/expands the focused panel (persisted per panel in
 * localStorage), t toggles between the dark and light themes (persisted in
 * localStorage), x marks the focused item as seen/unseen (dimmed; persisted
 * server-side via /api/seen so it is shared across browsers), ? toggles a
 * small help overlay (Escape closes it), and / opens a filter bar that
 * live-filters items across all panels (Escape clears and closes).
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
  ["c", "Collapse or expand the focused panel"],
  ["t", "Toggle light / dark theme"],
  ["x", "Mark the focused item seen / unseen"],
  ["/", "Filter items across panels"],
  ["?", "Show or hide this help"],
  ["Esc", "Close this help"],
];

/**
 * Split a raw filter query into lowercase search terms. Non-strings (a
 * detached input, undefined value) yield no terms, i.e. "match everything".
 */
export function parseFilterQuery(raw) {
  if (typeof raw !== "string") return [];
  return raw.toLowerCase().split(/\s+/).filter((term) => term.length > 0);
}

/**
 * True when every term occurs in the item text (case-insensitive AND).
 * An empty term list matches everything, so clearing the input restores all
 * items without a special case at the call site.
 */
export function itemMatchesFilter(terms, text) {
  if (!Array.isArray(terms) || terms.length === 0) return true;
  const haystack = String(text ?? "").toLowerCase();
  return terms.every((term) => haystack.includes(String(term).toLowerCase()));
}

/** localStorage key holding the JSON array of collapsed panel ids. */
export const COLLAPSE_STORAGE_KEY = "pace.collapsed-panels";

/**
 * Parse the stored collapsed-panel list. localStorage contents are untrusted
 * (another tab, an old version, manual edits), so anything that is not a
 * JSON array yields [], and non-string / empty entries are dropped.
 */
export function parseStoredPanelIds(raw) {
  if (typeof raw !== "string" || raw.length === 0) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id) => typeof id === "string" && id.length > 0);
  } catch {
    return [];
  }
}

/**
 * Return a new list with `id` removed if present, appended otherwise.
 * Invalid ids (non-strings, "") leave the list unchanged so a panel without
 * a data-panel-id can never pollute the stored state.
 */
export function togglePanelId(ids, id) {
  const list = Array.isArray(ids)
    ? ids.filter((entry) => typeof entry === "string" && entry.length > 0)
    : [];
  if (typeof id !== "string" || id.length === 0) return list;
  return list.includes(id) ? list.filter((entry) => entry !== id) : [...list, id];
}

/* ------------------------------------------------------------------ */
/* DOM wiring (browser only)                                          */
/* ------------------------------------------------------------------ */

function reducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Focusable targets inside a panel: visible item links, else its refresh button. */
function focusTargets(panel) {
  if (panel.classList.contains("panel-collapsed")) {
    // A collapsed panel keeps exactly one target (its refresh button) so
    // h/l can still land on it and "c" can expand it again.
    const refresh = panel.querySelector(".refresh-btn");
    return refresh ? [refresh] : [];
  }
  const links = Array.from(panel.querySelectorAll(".panel-body .item-title a")).filter(
    (link) => {
      const item = link.closest ? link.closest(".item") : null;
      return !(item && item.hidden);
    },
  );
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

/** localStorage key holding the chosen theme ("light"; absent = dark). */
export const THEME_STORAGE_KEY = "pace.theme";

/**
 * Normalize a stored theme value. localStorage contents are untrusted, so
 * anything other than the literal string "light" means the dark default.
 */
export function parseStoredTheme(raw) {
  return raw === "light" ? "light" : "dark";
}

/** The theme to switch to from `current` ("dark" <-> "light"). */
export function nextTheme(current) {
  return parseStoredTheme(current) === "light" ? "dark" : "light";
}

/* ------------------------------------------------------------------ */
/* Panel collapse (toggled with "c", persisted in localStorage)        */
/* ------------------------------------------------------------------ */

function readCollapsedIds() {
  try {
    return parseStoredPanelIds(window.localStorage.getItem(COLLAPSE_STORAGE_KEY));
  } catch {
    return []; // storage disabled (private mode, embedded webview)
  }
}

function writeCollapsedIds(ids) {
  try {
    if (ids.length === 0) window.localStorage.removeItem(COLLAPSE_STORAGE_KEY);
    else window.localStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // Storage unavailable: collapse still works, it just won't persist.
  }
}

function setPanelCollapsed(panel, collapsed) {
  panel.classList.toggle("panel-collapsed", collapsed);
}

/** Re-apply the persisted collapsed state to the freshly rendered page. */
function restoreCollapsedPanels() {
  const ids = readCollapsedIds();
  if (ids.length === 0) return;
  for (const panel of document.querySelectorAll(".panel[data-panel-id]")) {
    if (ids.includes(panel.getAttribute("data-panel-id"))) {
      setPanelCollapsed(panel, true);
    }
  }
}

/** Collapse/expand the panel containing focus and persist the change. */
function toggleFocusedPanel() {
  const active = document.activeElement;
  const panel = active && active.closest ? active.closest(".panel") : null;
  if (!panel) return;
  const collapsed = !panel.classList.contains("panel-collapsed");
  setPanelCollapsed(panel, collapsed);
  const id = panel.getAttribute("data-panel-id");
  if (id) writeCollapsedIds(togglePanelId(readCollapsedIds(), id));
  if (collapsed) {
    // Focus was inside the now-hidden body; move it to the panel's one
    // remaining target so keyboard navigation doesn't fall off the page.
    const target = focusTargets(panel)[0];
    if (target) target.focus({ preventScroll: true });
  }
}

/* ------------------------------------------------------------------ */
/* Theme toggle (toggled with "t", persisted in localStorage)          */
/* ------------------------------------------------------------------ */

function readTheme() {
  try {
    return parseStoredTheme(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "dark"; // storage disabled (private mode, embedded webview)
  }
}

function applyTheme(theme) {
  if (theme === "light") document.documentElement.setAttribute("data-theme", "light");
  else document.documentElement.removeAttribute("data-theme");
}

function toggleTheme() {
  const theme = nextTheme(readTheme());
  applyTheme(theme);
  try {
    if (theme === "light") window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    else window.localStorage.removeItem(THEME_STORAGE_KEY);
  } catch {
    // Storage unavailable: the toggle still works, it just won't persist.
  }
}

/** Re-apply the persisted theme choice to the freshly rendered page. */
function restoreTheme() {
  const theme = readTheme();
  if (theme !== "dark") applyTheme(theme);
}

/* ------------------------------------------------------------------ */
/* Seen/read item state (toggled with "x", persisted via /api/seen)    */
/* ------------------------------------------------------------------ */

/** Class marking an item the user has already seen (dimmed by the stylesheet). */
export const SEEN_CLASS = "item-seen";

/**
 * Extract the seen-key list from a GET /api/seen response body. The payload
 * crosses a network boundary, so anything that is not `{ keys: string[] }`
 * yields [] and non-string / empty entries are dropped.
 */
export function parseSeenKeys(body) {
  if (typeof body !== "object" || body === null || !Array.isArray(body.keys)) return [];
  return body.keys.filter((key) => typeof key === "string" && key.length > 0);
}

/**
 * API base for same-origin fetches: this module is served as
 * `${basePath}/dashboard.js`, so stripping the filename from its own URL
 * yields the dashboard root wherever it is mounted.
 */
function apiBase() {
  return import.meta.url.replace(/\/dashboard\.js.*$/, "");
}

function itemForSeenToggle() {
  const active = document.activeElement;
  const item = active && active.closest ? active.closest(".item") : null;
  return item && item.getAttribute("data-seen-key") ? item : null;
}

function applySeenKeys(keys) {
  if (keys.length === 0) return;
  const set = new Set(keys);
  for (const item of document.querySelectorAll(".item[data-seen-key]")) {
    if (set.has(item.getAttribute("data-seen-key"))) item.classList.add(SEEN_CLASS);
  }
}

/** Re-apply the server-persisted seen marks to the freshly rendered page. */
function restoreSeenItems() {
  fetch(`${apiBase()}/api/seen`)
    .then((res) => (res.ok ? res.json() : null))
    .then((body) => applySeenKeys(parseSeenKeys(body)))
    .catch(() => {
      // Server unreachable: the dashboard stays usable, items just aren't dimmed.
    });
}

/** Toggle the focused item's seen state optimistically and persist it. */
function toggleFocusedItemSeen() {
  const item = itemForSeenToggle();
  if (!item) return;
  const key = item.getAttribute("data-seen-key");
  const seen = !item.classList.contains(SEEN_CLASS);
  // Every duplicate of the story shares the key, so keep the page consistent
  // with what the server will store.
  const twins = document.querySelectorAll(".item[data-seen-key]");
  const toggle = (on) => {
    for (const twin of twins) {
      if (twin.getAttribute("data-seen-key") === key) twin.classList.toggle(SEEN_CLASS, on);
    }
  };
  toggle(seen);
  fetch(`${apiBase()}/api/seen`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ key, seen }),
  })
    .then((res) => {
      if (!res.ok) toggle(!seen); // rejected: roll the optimistic dimming back
    })
    .catch(() => toggle(!seen));
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

/* ------------------------------------------------------------------ */
/* Item filter bar (toggled with "/")                                  */
/* ------------------------------------------------------------------ */

let filterEl = null;
let filterInput = null;
let filterCount = null;
let filterReturnFocus = null;

/** Hide/show items to match the query; dim panels left with no matches. */
function applyFilter(raw) {
  const terms = parseFilterQuery(raw);
  let visible = 0;
  let total = 0;
  for (const item of document.querySelectorAll(".panel-body .item")) {
    total += 1;
    const match = itemMatchesFilter(terms, item.textContent);
    item.hidden = !match;
    if (match) visible += 1;
  }
  for (const panel of document.querySelectorAll(".panel")) {
    const items = panel.querySelectorAll(".panel-body .item");
    const anyVisible = Array.from(items).some((item) => !item.hidden);
    panel.classList.toggle("filter-no-match", items.length > 0 && !anyVisible);
  }
  if (filterCount) {
    filterCount.textContent = terms.length === 0 ? "" : `${visible} / ${total}`;
  }
}

function buildFilterBar() {
  const bar = document.createElement("div");
  bar.className = "item-filter";
  bar.setAttribute("role", "search");
  bar.hidden = true;

  const input = document.createElement("input");
  input.type = "text";
  input.className = "item-filter-input";
  input.placeholder = "Filter items…";
  input.setAttribute("aria-label", "Filter items across panels");
  input.addEventListener("input", () => applyFilter(input.value));
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeFilter();
      event.preventDefault();
      event.stopPropagation();
    } else if (event.key === "Enter") {
      // Jump to the first visible match; the filter stays applied.
      const panels = navigablePanels();
      const firstLink = panels
        .map((panel) => focusTargets(panel)[0])
        .find((target) => target && target.matches && target.matches(".item-title a"));
      if (firstLink) focusElement(firstLink);
      event.preventDefault();
    }
  });
  bar.appendChild(input);

  const count = document.createElement("span");
  count.className = "item-filter-count";
  count.setAttribute("aria-live", "polite");
  bar.appendChild(count);

  document.body.appendChild(bar);
  filterInput = input;
  filterCount = count;
  return bar;
}

function filterOpen() {
  return filterEl !== null && !filterEl.hidden;
}

function openFilter() {
  if (filterEl === null) filterEl = buildFilterBar();
  filterReturnFocus = document.activeElement;
  filterEl.hidden = false;
  filterInput.focus();
  filterInput.select();
}

/** Close the bar and clear the filter so every item is visible again. */
function closeFilter() {
  if (!filterOpen()) return;
  filterInput.value = "";
  applyFilter("");
  filterEl.hidden = true;
  if (filterReturnFocus && filterReturnFocus.isConnected) filterReturnFocus.focus();
  filterReturnFocus = null;
}

function onKeydown(event) {
  if (shouldIgnoreKeydown(event)) return;

  if (event.key === "/") {
    openFilter();
    event.preventDefault();
    return;
  }
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
    } else if (filterOpen()) {
      closeFilter();
      event.preventDefault();
    }
    return;
  }
  if (event.key === "r" && !event.shiftKey) {
    refreshFocusedPanel();
    return;
  }
  if (event.key === "c" && !event.shiftKey) {
    toggleFocusedPanel();
    return;
  }
  if (event.key === "t" && !event.shiftKey) {
    toggleTheme();
    return;
  }
  if (event.key === "x" && !event.shiftKey) {
    toggleFocusedItemSeen();
    return;
  }

  const move = keyMove(event.key);
  if (move === null || event.shiftKey) return;
  if (moveFocus(move)) event.preventDefault();
}

if (typeof document !== "undefined" && typeof window !== "undefined") {
  document.addEventListener("keydown", onKeydown);
  restoreCollapsedPanels();
  restoreTheme();
  restoreSeenItems();
}
