import type { TransformContext } from "./transforms";
import { createKeyedMutex, type KeyedMutex } from "./keyed-mutex";

export interface RunningGuarded {
  running: boolean;
  /** Error message from the most recent completed run, cleared on success. */
  lastError?: string;
  /** ISO timestamp of the most recent successful run. */
  lastSuccessAt?: string;
  /** ISO timestamp of the most recent failed run. */
  lastFailureAt?: string;
  /** Wall-clock duration (ms, integer) of the most recent completed run. */
  lastDurationMs?: number;
  /** Items produced by the most recent successful run (fetched for adapters, gathered inputs for pipelines). */
  lastItemCount?: number;
}

export interface TimedEntryBase extends RunningGuarded {
  panelIds: string[];
  intervalMs: number;
  timer: ReturnType<typeof setInterval> | null;
  initialTimer?: ReturnType<typeof setTimeout> | null;
}

export interface AdapterEntry extends TimedEntryBase {
  name: string;
  adapterConfig: import("./config/types").IngestAdapterConfig;
  adapter: import("./adapters/types").Adapter;
  /**
   * Panels where this declarative adapter may prune its stale `${name}:` rows
   * after a fetch. Excludes panels shared with another source of the same
   * adapter type (their id namespaces collide, so pruning would delete the
   * sibling's rows). Empty for non-declarative adapters.
   */
  prunePanelIds: string[];
  /**
   * Panels this source shares with at least one OTHER adapter source. On
   * these panels adapter-level transforms are scoped to rows this source
   * owns (owner_source), so e.g. `latest count:5` cannot consume-and-delete
   * a co-tenant adapter's items on every refresh.
   */
  sharedPanelIds: string[];
}

export interface PipelineEntry extends TimedEntryBase {
  config: import("./config/types").PipelineConfig;
  initialTimer: ReturnType<typeof setTimeout> | null;
}

/** Mutable scheduler runtime - single place for lifecycle and test resets. */
export class SchedulerState {
  readonly adapterEntries: AdapterEntry[] = [];
  readonly pipelineEntries: PipelineEntry[] = [];
  transformCtx: TransformContext = { llmModel: null };
  sourceToReadKey = new Map<string, string>();
  /** Serializes panel writes so concurrent refreshes of sources sharing a panel cannot lose updates. */
  panelLocks: KeyedMutex = createKeyedMutex();
  pruneTimer: ReturnType<typeof setInterval> | null = null;
  /**
   * Refresh runs currently executing (adapter fetches, pipeline jobs).
   * Entries remove themselves on settle. Deliberately NOT cleared by reset():
   * shutdown stops timers first and then drains what was already in flight.
   */
  readonly inFlight = new Set<Promise<unknown>>();

  isStarted(): boolean {
    return this.adapterEntries.length > 0 || this.pipelineEntries.length > 0 || this.pruneTimer !== null;
  }

  reset(clearTimers: (entry: TimedEntryBase) => void): void {
    for (const entry of [...this.adapterEntries, ...this.pipelineEntries]) {
      clearTimers(entry);
    }
    this.adapterEntries.length = 0;
    this.pipelineEntries.length = 0;
    this.sourceToReadKey = new Map();
    this.transformCtx = { llmModel: null };
    this.panelLocks = createKeyedMutex();
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = null;
    }
  }
}

export function createSchedulerState(): SchedulerState {
  return new SchedulerState();
}