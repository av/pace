/**
 * Shared helper to normalize unknown errors to string message.
 * Used across CLI, scheduler, and adapters for consistent error strings.
 */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err && typeof (err as any).message === "string") {
    return (err as any).message;
  }
  return String(err);
}

/**
 * Parses a port number from string input (e.g. process.env.PORT or CLI --port arg).
 * Returns the number if valid integer in [1,65535], otherwise the fallback (default 7453).
 */
export function parsePort(input: string | undefined, fallback = 7453): number {
  const n = parseInt(input ?? String(fallback), 10);
  if (isNaN(n) || n < 1 || n > 65535) {
    return fallback;
  }
  return n;
}

/** Returns true iff n is a finite integer port in the valid range [1, 65535]. */
export function isValidPort(n: number): boolean {
  return !isNaN(n) && n >= 1 && n <= 65535;
}

/**
 * Returns the effective name for an adapter config entry, preferring the explicit `name` (for display/alias) over the `type`.
 */
export function getAdapterName(cfg: { name?: string; type: string }): string {
  return cfg.name ?? cfg.type;
}
