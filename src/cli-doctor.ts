import type { Adapter } from "./adapters/types";
import type { AppConfig, IngestAdapterConfig } from "./config/types";
import { errorMessage, getAdapterName } from "./utils";

/** Per-source fetch budget; slow-but-alive feeds should pass, hung ones should not. */
export const DOCTOR_DEFAULT_TIMEOUT_MS = 20_000;

/** How many sources are probed at once (bounded so N slow feeds don't serialize). */
export const DOCTOR_CONCURRENCY = 4;

export type DoctorSourceResult = {
  name: string;
  type: string;
  ok: boolean;
  /** Items the fetch produced; only set on success. */
  itemCount?: number;
  durationMs: number;
  /** Diagnosable failure message; only set on failure. */
  error?: string;
};

export type DoctorReport = {
  results: DoctorSourceResult[];
  ok: boolean;
};

export type RunDoctorOptions = {
  timeoutMs?: number;
  concurrency?: number;
};

function timeoutError(ms: number): string {
  return `timed out after ${ms}ms`;
}

async function fetchWithTimeout(
  adapter: Adapter,
  adapterCfg: IngestAdapterConfig,
  timeoutMs: number,
): Promise<number> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(timeoutError(timeoutMs))), timeoutMs);
  });
  try {
    const items = await Promise.race([
      adapter.fetch({ type: adapterCfg.type, params: adapterCfg.params }),
      timeout,
    ]);
    return items.length;
  } finally {
    clearTimeout(timer);
  }
}

async function checkSource(
  adapters: Map<string, Adapter>,
  adapterCfg: IngestAdapterConfig,
  timeoutMs: number,
): Promise<DoctorSourceResult> {
  const name = getAdapterName(adapterCfg);
  const type = adapterCfg.type;
  const started = performance.now();
  const finish = (partial: Pick<DoctorSourceResult, "ok" | "itemCount" | "error">) => ({
    name,
    type,
    ...partial,
    durationMs: Math.round(performance.now() - started),
  });

  const adapter = adapters.get(type);
  if (!adapter) {
    // Config validation only WARNS on unknown types (extension adapters may
    // provide them), so a typo'd type reaches serve as a scheduler error.
    // Surface it here the same way the scheduler would.
    return finish({
      ok: false,
      error: `unknown adapter type "${type}" (run \`pace adapters list\` to see all valid types)`,
    });
  }

  try {
    const itemCount = await fetchWithTimeout(adapter, adapterCfg, timeoutMs);
    return finish({ ok: true, itemCount });
  } catch (err) {
    return finish({ ok: false, error: errorMessage(err) });
  }
}

/**
 * Probe every configured source with a live fetch and report per-source
 * ok/failure. Results preserve config order regardless of completion order.
 * Nothing is written to the database - fetched items are counted and dropped.
 */
export async function runDoctor(
  config: AppConfig,
  adapters: Map<string, Adapter>,
  options: RunDoctorOptions = {},
): Promise<DoctorReport> {
  const timeoutMs = options.timeoutMs ?? DOCTOR_DEFAULT_TIMEOUT_MS;
  const concurrency = Math.max(1, options.concurrency ?? DOCTOR_CONCURRENCY);

  const sources = config.adapters;
  const results: DoctorSourceResult[] = new Array(sources.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < sources.length) {
      const index = next++;
      results[index] = await checkSource(adapters, sources[index], timeoutMs);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, sources.length) }, () => worker()),
  );

  return { results, ok: results.every((r) => r.ok) };
}

function formatItemCount(count: number): string {
  return count === 1 ? "1 item" : `${count} items`;
}

export function formatDoctorReport(report: DoctorReport): string {
  if (report.results.length === 0) {
    return "doctor: no sources configured";
  }

  const label = (r: DoctorSourceResult) =>
    r.name === r.type ? r.name : `${r.name} (${r.type})`;
  const labelWidth = Math.max(...report.results.map((r) => label(r).length));

  const lines = report.results.map((r) => {
    const status = r.ok ? "ok  " : "FAIL";
    const detail = r.ok
      ? `${formatItemCount(r.itemCount ?? 0)} in ${r.durationMs}ms`
      : r.error ?? "unknown error";
    return `${status}  ${label(r).padEnd(labelWidth)}  ${detail}`;
  });

  const failed = report.results.filter((r) => !r.ok).length;
  const total = report.results.length;
  const noun = total === 1 ? "source" : "sources";
  const summary =
    failed === 0
      ? `all ${total} ${noun} ok`
      : `${total - failed} ok, ${failed} failed (${total} ${noun})`;

  return `${lines.join("\n")}\n\n${summary}`;
}

export function formatDoctorUsage(): string {
  return `Usage: pace doctor [options]

Fetches every configured source once and reports per-source ok/failure
with the underlying error message. Nothing is written to the database.

Options:
  -c, --config <path>   Path to config file (default: ./config.yaml)
  -P, --preset <name>   Use a bundled preset

Exit status: 0 when every source fetches successfully, 1 otherwise.
`;
}
