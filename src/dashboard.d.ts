/**
 * Type declarations for src/dashboard.js — the keyboard-navigation client
 * module served to browsers as-is (plain JS, no build step). Only the pure,
 * unit-testable exports are declared here; the DOM wiring is private.
 */

/** One entry of the navigation table: which axis to move on and how far. */
export type KeyMove = { axis: "item" | "panel"; delta: 1 | -1 };

/** Shape of the keydown facets shouldIgnoreKeydown inspects (all optional). */
export type KeydownLike = {
  defaultPrevented?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  target?: unknown;
};

export declare function moveIndex(current: number, delta: number, length: number): number;
export declare function isTypingTarget(el: unknown): boolean;
export declare function shouldIgnoreKeydown(event: KeydownLike): boolean;
export declare const KEY_MOVES: Record<string, KeyMove>;
export declare function keyMove(key: string): KeyMove | null;
export declare const HELP_ROWS: ReadonlyArray<readonly [string, string]>;
export declare function parseFilterQuery(raw: unknown): string[];
export declare function itemMatchesFilter(terms: readonly string[], text: unknown): boolean;
export declare function searchFeedUrl(base: unknown, raw: unknown): string | null;
export declare const COLLAPSE_STORAGE_KEY: string;
export declare function parseStoredPanelIds(raw: unknown): string[];
export declare function togglePanelId(ids: unknown, id: unknown): string[];
export declare function collapseAllTarget(flags: unknown): boolean;
export declare const THEME_STORAGE_KEY: string;
export declare function parseStoredTheme(raw: unknown): "dark" | "light";
export declare function nextTheme(current: unknown): "dark" | "light";
export declare function parseStoredThemeChoice(raw: unknown): "dark" | "light" | null;
export declare function resolveTheme(
  storedChoice: unknown,
  systemPrefersLight: boolean,
): "dark" | "light";
export declare const SEEN_CLASS: string;
export declare function autoSeenItem(target: unknown): object | null;
export declare function parseSeenKeys(body: unknown): string[];
export declare function panelSeenTarget(flags: unknown): boolean;
export declare const HIDE_SEEN_CLASS: string;
export declare const HIDE_SEEN_STORAGE_KEY: string;
export declare function parseStoredHideSeen(raw: unknown): boolean;
export declare const COLLAPSE_BTN_CLASS: string;
export declare const PANEL_SEEN_BTN_CLASS: string;
export declare const ITEM_SEEN_BTN_CLASS: string;
export declare function collapseButtonLabel(title: unknown, collapsed: boolean): string;
export declare function itemSeenButtonLabel(seen: unknown): string;
export declare function panelSeenButtonLabel(title: unknown): string;
export declare const TOOLBAR_CLASS: string;
export declare const THEME_BTN_CLASS: string;
export declare const HIDE_SEEN_BTN_CLASS: string;
export declare const HELP_BTN_CLASS: string;
export declare function themeButtonLabel(theme: unknown): string;
export declare function hideSeenButtonLabel(on: unknown): string;
