/** @jsx jsx */
import { jsx } from "hono/jsx";
import type { FC } from "hono/jsx";
import type { LayoutNodeConfig, FlexContainerConfig, PanelConfig } from "./config";
import { isPanel, resolvePanelId } from "./config";
import type { ContentItemRow } from "./db";
import { relativeTime, safeLinkUrl } from "./utils";

function flexStyle(f?: number): string {
  return `flex:${f ?? 1};`;
}

function flexContainerStyle(container: FlexContainerConfig): string {
  return `display:flex; flex-direction:${container.direction}; gap:${container.gap ?? "1rem"}; ${flexStyle(container.flex)}`;
}

const ContentItemCard: FC<{ item: ContentItemRow }> = ({ item }) => {
  const href = safeLinkUrl(item.url);
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

const Panel: FC<{ node: PanelConfig; panelData: Map<string, PanelData> }> = ({ node, panelData }) => {
  const data = panelData.get(node.panel);
  const panelId = resolvePanelId(node);
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

export interface PanelData {
  items: ContentItemRow[];
  lastRefreshedAt?: string | null;
}

const LayoutNode: FC<{ node: LayoutNodeConfig; panelData: Map<string, PanelData> }> = ({ node, panelData }) => {
  if (isPanel(node)) {
    return <Panel node={node} panelData={panelData} />;
  }

  const container = node as FlexContainerConfig;
  return (
    <div
      class="flex-container"
      style={flexContainerStyle(container)}
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
      <div class="flex-root">
        <LayoutNode node={layout} panelData={panelData} />
      </div>
      <footer class="footer">
        <a href="https://github.com/av/pace" target="_blank" rel="noopener noreferrer">Pace</a> / {updatedAt} UTC
      </footer>
    </body>
  </html>
);

export function renderDashboard(props: DashboardProps): string {
  const html = Dashboard(props) as unknown as { toString(): string };
  return "<!DOCTYPE html>" + html.toString();
}
