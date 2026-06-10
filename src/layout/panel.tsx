/** @jsx jsx */
import { jsx } from "hono/jsx";
import type { FC } from "hono/jsx";
import type { PanelConfig } from "../config";
import { resolvePanelId } from "../config";
import type { ContentItemRow, DashboardPanelSnapshot } from "../db";
import { relativeTime, safeLinkUrl } from "../utils";
import { flexStyle } from "./flex-styles";

export type PanelData = DashboardPanelSnapshot;

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