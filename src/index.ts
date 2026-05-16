import { Hono } from "hono";
import { readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "./config";
import { initDb, closeDb, getRecentItems, getItemsByAdapter, type ContentItemRow } from "./db";
import { discoverAdapters } from "./adapters/index";
import { renderDashboard } from "./views";
import { createModel, lensItems, generateDigest } from "./llm";
import { startScheduler } from "./scheduler";
import type { ContentItem } from "./adapters/types";

const app = new Hono();

app.use("*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("Content-Security-Policy", "default-src 'self'");
});

const config = loadConfig();

mkdirSync(join(process.cwd(), "data"), { recursive: true });
initDb();

const adapters = await discoverAdapters();
const llmModel = config.llm ? createModel(config.llm) : null;

startScheduler(config.adapters, adapters, llmModel);

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

function reorderRows(rows: ContentItemRow[], lensed: ContentItem[]): ContentItemRow[] {
  const rowMap = new Map<string, ContentItemRow>();
  for (const row of rows) rowMap.set(row.id, row);
  return lensed.map((item) => rowMap.get(item.id)).filter((row): row is ContentItemRow => !!row);
}

const LLM_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const digestCache: { entry: CacheEntry<string | null> | null } = { entry: null };
const lensCache = new Map<string, CacheEntry<ContentItem[]>>();

function getCached<T>(entry: CacheEntry<T> | null): T | undefined {
  if (entry && Date.now() < entry.expiresAt) return entry.value;
  return undefined;
}

const cssContent = readFileSync(join(import.meta.dir, "styles.css"), "utf-8");
app.get("/styles.css", (c) => {
  return c.body(cssContent, 200, { "Content-Type": "text/css", "Cache-Control": "public, max-age=3600" });
});

app.get("/health", (c) => c.json({ status: "ok" }));

app.get("/", async (c) => {
  const panelNames = config.layout?.panels ?? ["all"];
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  const hasLlm = !!llmModel;

  let digestText: string | null = null;

  const panels = await Promise.all(
    panelNames.map(async (name) => {
      if (name === "digest") {
        if (llmModel) {
          const cached = getCached(digestCache.entry);
          if (cached !== undefined) {
            digestText = cached;
          } else {
            const allItems = getRecentItems(50).map(rowToContentItem);
            digestText = await generateDigest(
              llmModel,
              allItems,
              config.llm?.digest ?? {}
            );
            digestCache.entry = { value: digestText, expiresAt: Date.now() + LLM_CACHE_TTL };
          }
        }
        return { type: "digest" as const, title: "Digest", items: [] as ContentItemRow[] };
      }

      let rows =
        name === "all" ? getRecentItems(50) : getItemsByAdapter(name, 50);

      if (llmModel && config.llm?.interests?.length) {
        const cacheKey = name;
        const cachedLens = getCached(lensCache.get(cacheKey) ?? null);
        if (cachedLens !== undefined) {
          rows = reorderRows(rows, cachedLens);
        } else {
          const contentItems = rows.map(rowToContentItem);
          const lensed = await lensItems(llmModel, contentItems, config.llm.interests);
          lensCache.set(cacheKey, { value: lensed, expiresAt: Date.now() + LLM_CACHE_TTL });
          rows = reorderRows(rows, lensed);
        }
      }

      return { type: "feed" as const, title: name === "all" ? "All" : name, items: rows };
    })
  );

  const content = renderDashboard({ panels, hasLlm, updatedAt: now, digestText });
  return c.html(content);
});

const parsedPort = parseInt(process.env.PORT ?? "3000", 10);
const port = isNaN(parsedPort) ? 3000 : parsedPort;

import { stopScheduler } from "./scheduler";

process.on("SIGTERM", () => { stopScheduler(); closeDb(); process.exit(0); });
process.on("SIGINT", () => { stopScheduler(); closeDb(); process.exit(0); });

console.log(`pace listening on http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
};
