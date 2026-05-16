import type { Adapter, AdapterConfig } from "./adapters/types";
import type { Model, Api } from "@mariozechner/pi-ai";
import { saveItems, getDb } from "./db";
import { summarizeItem } from "./llm";

interface SchedulerEntry {
  adapterConfig: AdapterConfig;
  adapter: Adapter;
  intervalMs: number;
  timer: ReturnType<typeof setInterval> | null;
  running: boolean;
}

const entries: SchedulerEntry[] = [];
let llmModel: Model<Api> | null = null;
let pruneTimer: ReturnType<typeof setInterval> | null = null;

export function startScheduler(
  adapterConfigs: AdapterConfig[],
  adapters: Map<string, Adapter>,
  model?: Model<Api> | null,
): void {
  llmModel = model ?? null;

  for (const config of adapterConfigs) {
    const adapter = adapters.get(config.type);
    if (!adapter) {
      console.warn(`scheduler: no adapter found for type "${config.type}", skipping`);
      continue;
    }

    const intervalMin = Math.max(config.refresh_interval ?? 15, 1);
    const intervalMs = intervalMin * 60 * 1000;

    const entry: SchedulerEntry = {
      adapterConfig: config,
      adapter,
      intervalMs,
      timer: null,
      running: false,
    };

    runAdapter(entry);
    entry.timer = setInterval(() => runAdapter(entry), intervalMs);
    entries.push(entry);

    console.log(`scheduler: ${config.type} — every ${intervalMin}m`);
  }

  pruneOldItems();
  pruneTimer = setInterval(pruneOldItems, 24 * 60 * 60 * 1000);
}

async function runAdapter(entry: SchedulerEntry): Promise<void> {
  if (entry.running) return;
  entry.running = true;

  const { adapter, adapterConfig } = entry;
  try {
    const items = await adapter.fetch(adapterConfig);
    if (items.length > 0) {
      saveItems(adapter.name, items);
      console.log(`scheduler: ${adapter.name} — fetched ${items.length} items`);

      if (llmModel) {
        const db = getDb();
        const unsummarized = db.prepare(
          `SELECT id, title, url, source, body, timestamp FROM content_items
           WHERE adapter_name = ? AND summary IS NULL
           ORDER BY timestamp DESC LIMIT 10`
        ).all(adapter.name) as any[];

        for (const row of unsummarized) {
          const summary = await summarizeItem(llmModel, {
            id: row.id,
            title: row.title,
            url: row.url,
            source: row.source,
            timestamp: new Date(row.timestamp),
            body: row.body ?? undefined,
          });
          if (summary) {
            db.prepare("UPDATE content_items SET summary = ? WHERE id = ?").run(summary, row.id);
          }
        }
      }
    }
  } catch (err) {
    console.warn(`scheduler: ${adapter.name} — error:`, err);
  } finally {
    entry.running = false;
  }
}

function pruneOldItems(): void {
  try {
    const db = getDb();
    const result = db.prepare(
      "DELETE FROM content_items WHERE fetched_at < datetime('now', '-30 days')"
    ).run();
    if (result.changes > 0) {
      console.log(`scheduler: pruned ${result.changes} items older than 30 days`);
    }
  } catch (err) {
    console.warn("scheduler: prune error:", err);
  }
}

export function stopScheduler(): void {
  for (const entry of entries) {
    if (entry.timer) clearInterval(entry.timer);
  }
  entries.length = 0;
  if (pruneTimer) {
    clearInterval(pruneTimer);
    pruneTimer = null;
  }
}
