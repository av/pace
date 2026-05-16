import { Hono } from "hono";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "./config";
import { initDb, getRecentItems, getItemsByAdapter, type ContentItemRow } from "./db";
import { discoverAdapters } from "./adapters/index";
import { renderDashboard } from "./views";
import { createModel, lensItems, summarizeItem, generateDigest } from "./llm";
import { startScheduler } from "./scheduler";
import type { ContentItem } from "./adapters/types";

import { mkdirSync } from "node:fs";

const app = new Hono();

// load config
const config = loadConfig();

// ensure data directory exists before DB init
mkdirSync(join(process.cwd(), "data"), { recursive: true });

// init database
initDb();

// discover adapters
const adapters = await discoverAdapters();

// init LLM model (null if not configured)
const llmModel = config.llm ? createModel(config.llm) : null;

// start adapter scheduler — fetches content on startup and periodically
startScheduler(config.adapters, adapters);

/** Convert ContentItemRow (DB) to ContentItem (adapter) for LLM functions */
function rowToContentItem(row: ContentItemRow): ContentItem {
  return {
    id: row.id,
    title: row.title,
    url: row.url,
    source: row.source,
    timestamp: new Date(row.timestamp),
    body: row.body ?? undefined,
  };
}

/** Reorder rows based on lensed ContentItem order */
function reorderRows(rows: ContentItemRow[], lensed: ContentItem[]): ContentItemRow[] {
  const rowMap = new Map<string, ContentItemRow>();
  for (const row of rows) rowMap.set(row.id, row);
  return lensed.map((item) => rowMap.get(item.id)!).filter(Boolean);
}

// serve static css
app.get("/styles.css", async (c) => {
  const css = readFileSync(join(import.meta.dir, "styles.css"), "utf-8");
  return c.body(css, 200, { "Content-Type": "text/css" });
});

// main dashboard route — server-rendered HTML via Hono JSX
app.get("/", async (c) => {
  const panelNames = config.layout?.panels ?? ["all"];
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  const hasLlm = !!llmModel;

  let digestText: string | null = null;

  const panels = await Promise.all(
    panelNames.map(async (name) => {
      if (name === "digest") {
        // Generate digest via LLM if available
        if (llmModel) {
          const allItems = getRecentItems(50).map(rowToContentItem);
          digestText = await generateDigest(
            llmModel,
            allItems,
            config.llm?.digest ?? {}
          );
        }
        return { type: "digest" as const, title: "Digest", items: [] as ContentItemRow[] };
      }

      let rows =
        name === "all" ? getRecentItems(50) : getItemsByAdapter(name, 50);

      // Apply lensing if LLM + interests configured
      if (llmModel && config.llm?.interests?.length) {
        const contentItems = rows.map(rowToContentItem);
        const lensed = await lensItems(llmModel, contentItems, config.llm.interests);
        rows = reorderRows(rows, lensed);
      }

      return { type: "feed" as const, title: name === "all" ? "All" : name, items: rows };
    })
  );

  const content = renderDashboard({ panels, hasLlm, updatedAt: now, digestText });
  return c.html(content);
});

const port = parseInt(process.env.PORT ?? "3000", 10);

import { stopScheduler } from "./scheduler";

process.on("SIGTERM", () => { stopScheduler(); process.exit(0); });
process.on("SIGINT", () => { stopScheduler(); process.exit(0); });

console.log(`pace listening on http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
};
