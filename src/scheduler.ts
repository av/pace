import type { Adapter, AdapterConfig } from "./adapters/types";
import { saveItems } from "./db";

interface SchedulerEntry {
  adapterConfig: AdapterConfig;
  adapter: Adapter;
  intervalMs: number;
  timer: ReturnType<typeof setInterval> | null;
}

const entries: SchedulerEntry[] = [];

export function startScheduler(
  adapterConfigs: AdapterConfig[],
  adapters: Map<string, Adapter>,
): void {
  for (const config of adapterConfigs) {
    const adapter = adapters.get(config.type);
    if (!adapter) {
      console.warn(`scheduler: no adapter found for type "${config.type}", skipping`);
      continue;
    }

    const intervalMin = config.refresh_interval ?? 15;
    const intervalMs = intervalMin * 60 * 1000;

    const entry: SchedulerEntry = {
      adapterConfig: config,
      adapter,
      intervalMs,
      timer: null,
    };

    runAdapter(entry);
    entry.timer = setInterval(() => runAdapter(entry), intervalMs);
    entries.push(entry);

    console.log(`scheduler: ${config.type} — every ${intervalMin}m`);
  }
}

async function runAdapter(entry: SchedulerEntry): Promise<void> {
  const { adapter, adapterConfig } = entry;
  try {
    const items = await adapter.fetch(adapterConfig);
    if (items.length > 0) {
      saveItems(adapter.name, items);
      console.log(`scheduler: ${adapter.name} — fetched ${items.length} items`);
    }
  } catch (err) {
    console.warn(`scheduler: ${adapter.name} — error:`, err);
  }
}

export function stopScheduler(): void {
  for (const entry of entries) {
    if (entry.timer) clearInterval(entry.timer);
  }
  entries.length = 0;
}
