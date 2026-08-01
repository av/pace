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
