import { Hono } from "hono";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "./config";
import { initDb, getRecentItems, getItemsByAdapter } from "./db";
import { discoverAdapters } from "./adapters/index";
import { renderDashboard } from "./views";

const app = new Hono();

// load config
const config = loadConfig();

// init database
initDb();

// discover adapters
const adapters = await discoverAdapters();

// serve static css
app.get("/styles.css", async (c) => {
  const css = readFileSync(join(import.meta.dir, "styles.css"), "utf-8");
  return c.body(css, 200, { "Content-Type": "text/css" });
});

// main dashboard route — server-rendered HTML via Hono JSX
app.get("/", (c) => {
  const panelNames = config.layout?.panels ?? ["all"];
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  const hasLlm = !!(config.llm?.provider && config.llm?.api_key);

  const panels = panelNames.map((name) => {
    if (name === "all") {
      return { type: "feed" as const, title: "All", items: getRecentItems(50) };
    }
    if (name === "digest") {
      return { type: "digest" as const, title: "Digest", items: [] };
    }
    return { type: "feed" as const, title: name, items: getItemsByAdapter(name, 50) };
  });

  // llm and digest/summary references for graceful degradation
  const html = renderDashboard({ panels, hasLlm, updatedAt: now });
  return c.html(html);
});

const port = parseInt(process.env.PORT ?? "3000", 10);

console.log(`pace listening on http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
};
