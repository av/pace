import type { TransformContext } from "./transforms";

export interface RunningGuarded {
  running: boolean;
  lastError?: string;
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
  pruneTimer: ReturnType<typeof setInterval> | null = null;

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
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = null;
    }
  }
}

export function createSchedulerState(): SchedulerState {
  return new SchedulerState();
}