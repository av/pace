function hasStringMessage(err: unknown): err is { message: string } {
  return (
    typeof err === "object" &&
    err !== null &&
    "message" in err &&
    typeof (err as Record<string, unknown>).message === "string"
  );
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (hasStringMessage(err)) return err.message;
  return String(err);
}

export function parsePort(input: string | undefined, fallback = 7453): number {
  const n = parseInt(input ?? String(fallback), 10);
  if (isNaN(n) || n < 1 || n > 65535) {
    return fallback;
  }
  return n;
}

export function isValidPort(n: number): boolean {
  return !isNaN(n) && n >= 1 && n <= 65535;
}

export function getAdapterName(cfg: { name?: string; type: string }): string {
  return cfg.name ?? cfg.type;
}
