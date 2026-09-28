import type { Context } from "hono";
import {
  buildBrief,
  parseBriefLimit,
  parseBriefPerPanel,
  parseBriefSince,
  renderBriefJson,
  renderBriefMarkdown,
  resolveBriefPanelIds,
  type BriefContext,
  type BriefDocument,
} from "../brief";
import type { ServerRouteDeps } from "./routes";

export const BRIEF_MARKDOWN_CONTENT_TYPE = "text/markdown; charset=utf-8";

/** Brief context for a running server; embedders without config info get neutral defaults. */
export function serverBriefContext(deps: ServerRouteDeps): BriefContext {
  return {
    configLabel: deps.brief?.configLabel ?? "config",
    nonFeedSources: deps.brief?.nonFeedSources ?? new Set(),
    pipelineNames: deps.brief?.pipelineNames ?? new Set(),
    dashboardPanels: deps.dashboardPanels,
    panelNameToId: deps.panelNameToId,
    panelIdToRefreshSourceNames: deps.panelIdToRefreshSourceNames,
  };
}

type BriefRequestResult =
  | { ok: true; doc: BriefDocument; ctx: BriefContext }
  | { ok: false; status: 400 | 404; error: string };

/** Parse ?panel=&limit=&per_panel=&since= and build the brief. */
export function resolveBriefRequest(c: Context, deps: ServerRouteDeps): BriefRequestResult {
  const ctx = serverBriefContext(deps);
  const now = new Date();

  const panels = resolveBriefPanelIds(c.req.queries("panel") ?? [], ctx);
  if (!panels.ok) return { ok: false, status: 404, error: panels.error };
  const limit = parseBriefLimit(c.req.query("limit"));
  if (!limit.ok) return { ok: false, status: 400, error: limit.error };
  const perPanel = parseBriefPerPanel(c.req.query("per_panel"));
  if (!perPanel.ok) return { ok: false, status: 400, error: perPanel.error };
  const since = parseBriefSince(c.req.query("since"), now);
  if (!since.ok) return { ok: false, status: 400, error: since.error };

  const doc = buildBrief(
    ctx,
    { panelIds: panels.value, limit: limit.value, perPanel: perPanel.value, since: since.value },
    now,
  );
  return { ok: true, doc, ctx };
}

/** GET /api/brief — the brief as a pace.brief/v1 JSON document. */
export function handleApiBrief(c: Context, deps: ServerRouteDeps): Response {
  const result = resolveBriefRequest(c, deps);
  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.body(renderBriefJson(result.doc), 200, {
    "Content-Type": "application/json; charset=utf-8",
  });
}

/** GET /brief.md — the same brief as Markdown for one LLM read. */
export function handleBriefMarkdown(c: Context, deps: ServerRouteDeps): Response {
  const result = resolveBriefRequest(c, deps);
  if (!result.ok) return c.text(`${result.error}\n`, result.status);
  return c.body(renderBriefMarkdown(result.doc, result.ctx), 200, {
    "Content-Type": BRIEF_MARKDOWN_CONTENT_TYPE,
  });
}
