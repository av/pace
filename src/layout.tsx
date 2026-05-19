/** @jsx jsx */
/** @jsxFrag Fragment */
import { jsx, Fragment } from "hono/jsx";
import type { FC } from "hono/jsx";
import type { LayoutNodeConfig, PanelConfig, FlexContainerConfig } from "./config";
import { isPanel, resolvePanelId } from "./config";
import type { ContentItemRow } from "./db";

function safeUrl(url: string): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (["http:", "https:", "mailto:"].includes(parsed.protocol)) return url;
    return null;
  } catch {
    return null;
  }
}

function relativeTime(timestamp: string): string {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  if (isNaN(then)) return "";
  const diff = now - then;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const ContentItemCard: FC<{ item: ContentItemRow }> = ({ item }) => {
  const href = safeUrl(item.url);
  return (
    <div class="item">
      <div class="item-title">
        {href
          ? <a href={href} target="_blank" rel="noopener noreferrer">{item.title}</a>
          : <span>{item.title}</span>
        }
      </div>
      <div class="item-meta">
        <span class="item-source">{item.source}</span>
        <span class="item-time">{relativeTime(item.timestamp)}</span>
      </div>
      {item.summary && <div class="item-summary">{item.summary}</div>}
    </div>
  );
};

const Panel: FC<{ title: string; items: ContentItemRow[]; panelId: string; lastRefreshedAt?: string | null }> = ({ title, items, panelId, lastRefreshedAt }) => (
  <div class="panel">
    <div class="panel-header">
      <h2>{title}</h2>
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
);

export interface PanelData {
  items: ContentItemRow[];
  lastRefreshedAt?: string | null;
}

const LayoutNode: FC<{ node: LayoutNodeConfig; panelData: Map<string, PanelData> }> = ({ node, panelData }) => {
  if (isPanel(node)) {
    const data = panelData.get(node.panel);
    const pid = resolvePanelId(node);
    return (
      <div class="flex-panel" style={`flex:${node.flex ?? 1}; min-width:0; min-height:0;`}>
        <Panel title={node.panel} panelId={pid} items={data?.items ?? []} lastRefreshedAt={data?.lastRefreshedAt} />
      </div>
    );
  }

  const container = node as FlexContainerConfig;
  return (
    <div
      class="flex-container"
      style={`display:flex; flex-direction:${container.direction}; gap:${container.gap ?? "1rem"}; flex:${container.flex ?? 1};`}
    >
      {container.children.map((child) => (
        <LayoutNode node={child} panelData={panelData} />
      ))}
    </div>
  );
};

interface DashboardProps {
  layout: LayoutNodeConfig;
  panelData: Map<string, PanelData>;
  updatedAt: string;
}

const Dashboard: FC<DashboardProps> = ({ layout, panelData, updatedAt }) => (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>pace</title>
      <link rel="stylesheet" href="/styles.css" />
    </head>
    <body>
      <div class="header">
        <h1>pace</h1>
        <span class="updated">{updatedAt} UTC</span>
      </div>
      <div class="flex-root">
        <LayoutNode node={layout} panelData={panelData} />
      </div>
    </body>
  </html>
);

export function renderDashboard(props: DashboardProps): string {
  const html = Dashboard(props) as unknown as { toString(): string };
  return "<!DOCTYPE html>" + html.toString();
}
