/** @jsx jsx */
import { jsx } from "hono/jsx";
import type { FC } from "hono/jsx";
import type { ContentItemRow, PanelConfig, PanelData } from "./types";
import { resolvePanelId } from "./types";
import { relativeTime, safeLinkUrl } from "../utils";
import { flexStyle } from "./flex-styles";

function parseOrigins(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((o): o is string => typeof o === "string") : [];
  } catch {
    return [];
  }
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

function sourceColorClass(source: string): string {
  const s = source.toLowerCase();
  if (SOURCE_COLORS[s]) return SOURCE_COLORS[s];
  const base = s.split(":")[0];
  if (base !== s && SOURCE_COLORS[base]) return SOURCE_COLORS[base];
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

const ContentItemCard: FC<{ item: ContentItemRow }> = ({ item }) => {
  const href = safeLinkUrl(item.url);
  const origins = parseOrigins(item.origins);
  const merged = origins.length > 1;
  return (
    <div class="item">
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
        <span class="item-time">{relativeTime(item.timestamp)}</span>
      </div>
      {item.summary ? (
        <div class="item-summary">
          <span class="item-summary-label">summarized</span>
          {item.summary}
        </div>
      ) : item.body ? (
        <div class="item-body">{item.body}</div>
      ) : null}
    </div>
  );
};

export const Panel: FC<{ node: PanelConfig; panelData: Map<string, PanelData> }> = ({ node, panelData }) => {
  const data = panelData.get(node.panel);
  const panelId = data?.panelId ?? resolvePanelId(node);
  const items = data?.items ?? [];
  const lastRefreshedAt = data?.lastRefreshedAt;

  return (
    <div class="flex-panel" style={flexStyle(node.flex)}>
      <div class="panel">
        <div class="panel-header">
          <h2>{node.panel}</h2>
          <div class="panel-actions">
            {lastRefreshedAt && <span class="panel-refreshed">{relativeTime(lastRefreshedAt)}</span>}
            <form method="POST" action={`/refresh/${encodeURIComponent(panelId)}`}>
              <button type="submit" class="refresh-btn" title="Refresh">↻</button>
            </form>
          </div>
        </div>
        <div class="panel-body">
          {items.length > 0
            ? items.map((item) => <ContentItemCard item={item} />)
            : <div class="empty-state">No content yet</div>
          }
        </div>
      </div>
    </div>
  );
};