/** @jsxImportSource hono/jsx */
import type { FC } from "hono/jsx";
import type { ContentItemRow, DashboardRenderMode, PanelConfig, PanelData } from "./types";
import { resolvePanelId } from "./types";
import { absoluteUtcTime, parseJsonStringArray, relativeTime, safeLinkUrl } from "../utils";
import { itemSeenKey } from "../db";
import { flexStyle } from "./flex-styles";
import { stripHtml } from "../adapters/html";

const BODY_MAX_LENGTH = 200;

function truncateBody(body: string): string {
  const plain = stripHtml(body, { whitespace: "preserve" }).trim();
  if (plain.length <= BODY_MAX_LENGTH) return plain;
  return plain.slice(0, BODY_MAX_LENGTH) + "...";
}

const SOURCE_COLORS: Record<string, string> = {
  hackernews: "src-hn",
  hn: "src-hn",
  reddit: "src-reddit",
  github: "src-github",
  "github-releases": "src-github",
  lobsters: "src-lobsters",
  rss: "src-rss",
  arxiv: "src-arxiv",
  youtube: "src-youtube",
  npm: "src-npm",
  wikipedia: "src-wiki",
  lemmy: "src-lemmy",
  producthunt: "src-ph",
  podcast: "src-pod",
  stackexchange: "src-se",
  mastodon: "src-mast",
  devto: "src-devto",
  "dev.to": "src-devto",
  bookmarks: "src-bookmarks",
  counter: "src-counter",
};

export function sourceColorClass(source: string): string {
  // `source` comes from stored feed content — guard record lookups with
  // Object.hasOwn so keys like "constructor" don't leak Object.prototype.
  const s = source.toLowerCase();
  if (Object.hasOwn(SOURCE_COLORS, s)) return SOURCE_COLORS[s]!;
  const base = s.split(":")[0]!;
  if (base !== s && Object.hasOwn(SOURCE_COLORS, base)) return SOURCE_COLORS[base]!;
  if (s.startsWith("gh-") || s.startsWith("github")) return "src-github";
  if (s.startsWith("arxiv")) return "src-arxiv";
  if (s.startsWith("reddit") || s.startsWith("r/")) return "src-reddit";
  if (s.startsWith("wiki")) return "src-wiki";
  return "";
}

const SourcePill: FC<{ source: string }> = ({ source }) => {
  const cls = sourceColorClass(source);
  return <span class={cls ? `item-source ${cls}` : "item-source"}>{source}</span>;
};

function displayTimestamp(timestamp: string, mode: DashboardRenderMode): string {
  return mode === "static" ? absoluteUtcTime(timestamp) : relativeTime(timestamp);
}

/**
 * Timestamp rendered as a <time> element with a machine-readable datetime
 * attribute. Unparseable timestamps fall back to a plain span (an empty or
 * invalid datetime attribute would violate the <time> content model).
 */
const Timestamp: FC<{ timestamp: string; mode: DashboardRenderMode; class: string }> = ({ timestamp, mode, class: className }) => {
  const parsed = new Date(timestamp);
  const text = displayTimestamp(timestamp, mode);
  return isNaN(parsed.getTime())
    ? <span class={className}>{text}</span>
    : <time class={className} datetime={parsed.toISOString()}>{text}</time>;
};

/** Shared panel header: title plus refreshed-at / refresh-button actions (also used by CounterPanel). */
export const PanelHeader: FC<{
  title: string;
  panelId: string;
  lastRefreshedAt?: string | null;
  mode: DashboardRenderMode;
  basePath: string;
}> = ({ title, panelId, lastRefreshedAt, mode, basePath }) => (
  <div class="panel-header">
    <h2 title={title}>{title}</h2>
    <div class="panel-actions">
      {lastRefreshedAt && <Timestamp timestamp={lastRefreshedAt} mode={mode} class="panel-refreshed" />}
      {mode === "interactive" && (
        <form method="post" action={`${basePath}/refresh/${encodeURIComponent(panelId)}`}>
          <button type="submit" class="refresh-btn" title={`Refresh ${title}`} aria-label={`Refresh ${title}`}>
            <svg class="action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
              <path d="M20 10a8 8 0 1 0-1 7M20 4v6h-6" />
            </svg>
          </button>
        </form>
      )}
    </div>
  </div>
);

const ContentItemCard: FC<{ item: ContentItemRow; mode: DashboardRenderMode }> = ({ item, mode }) => {
  const href = safeLinkUrl(item.url);
  const origins = parseJsonStringArray(item.origins);
  const merged = origins.length > 1;
  return (
    // data-seen-key carries the item's dedup identity so the client-side
    // seen/read state (dashboard.js "x" key, /api/seen) can address it.
    <li class="item" data-seen-key={itemSeenKey(item)}>
      <div class="item-title">
        {href
          ? <a href={href} target="_blank" rel="noopener noreferrer">{item.title}</a>
          : <span>{item.title}</span>
        }
      </div>
      <div class="item-meta">
        {merged
          ? origins.map((o) => <SourcePill source={o} />)
          : <SourcePill source={item.source} />
        }
        {merged && <span class="item-merged">{origins.length} sources</span>}
        <Timestamp timestamp={item.timestamp} mode={mode} class="item-time" />
      </div>
      {item.summary ? (
        <div class="item-summary">
          <span class="item-summary-label">summarized</span>
          {item.summary}
        </div>
      ) : item.body ? (() => {
        const bodyText = truncateBody(item.body);
        return bodyText ? <div class="item-body">{bodyText}</div> : null;
      })() : null}
    </li>
  );
};

export const Panel: FC<{ node: PanelConfig; panelData: Map<string, PanelData>; mode: DashboardRenderMode; basePath?: string }> = ({ node, panelData, mode, basePath = "" }) => {
  const data = panelData.get(node.panel);
  const panelId = data?.panelId ?? resolvePanelId(node);
  const items = data?.items ?? [];
  const lastRefreshedAt = data?.lastRefreshedAt;

  return (
    <div class="flex-panel" style={flexStyle(node.flex)}>
      {/* data-auto-seen carries the panel's auto_mark_seen override (on/off);
          data-hide-seen carries its hide_seen override (on = always hide seen
          items, off = exempt from hide-seen mode); each absent when the panel
          follows the page-wide server setting. data-hide-seen is interactive
          only: static exports have no seen state, so the stamp would be inert
          and static pages stay free of hide-seen markers. */}
      <div
        class="panel"
        data-panel-id={panelId}
        data-auto-seen={node.auto_mark_seen === undefined ? undefined : node.auto_mark_seen ? "on" : "off"}
        data-hide-seen={node.hide_seen === undefined || mode !== "interactive" ? undefined : node.hide_seen ? "on" : "off"}
      >
        <PanelHeader
          title={node.panel}
          panelId={panelId}
          lastRefreshedAt={lastRefreshedAt}
          mode={mode}
          basePath={basePath}
        />
        <div class="panel-body">
          {items.length > 0
            ? <ul class="item-list">{items.map((item: ContentItemRow) => <ContentItemCard item={item} mode={mode} />)}</ul>
            : <div class="empty-state">No content yet</div>
          }
        </div>
      </div>
    </div>
  );
};
