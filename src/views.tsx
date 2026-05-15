/** @jsx jsx */
/** @jsxFrag Fragment */
import { jsx, Fragment } from "hono/jsx";
import type { FC } from "hono/jsx";
import type { ContentItemRow } from "./db";

function relativeTime(timestamp: string): string {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diff = now - then;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const ContentItemCard: FC<{ item: ContentItemRow }> = ({ item }) => (
  <div class="item">
    <div class="item-title">
      <a href={item.url} target="_blank" rel="noopener">{item.title}</a>
    </div>
    <div class="item-meta">
      <span class="item-source">{item.source}</span>
      <span class="item-time">{relativeTime(item.timestamp)}</span>
    </div>
    {item.summary && <div class="item-summary">{item.summary}</div>}
  </div>
);

const Panel: FC<{ title: string; items: ContentItemRow[] }> = ({ title, items }) => (
  <div class="panel">
    <div class="panel-header"><h2>{title}</h2></div>
    <div class="panel-body">
      {items.length > 0
        ? items.map((item) => <ContentItemCard item={item} />)
        : <div class="empty-state">No content yet</div>
      }
    </div>
  </div>
);

const DigestPanel: FC<{ hasLlm: boolean }> = ({ hasLlm }) => (
  <div class="panel">
    <div class="panel-header"><h2>Digest</h2></div>
    <div class="panel-body">
      <div class="digest-placeholder">
        {hasLlm
          ? "Digest will be generated on next refresh"
          : "Configure LLM in config.yaml to enable digests"
        }
      </div>
    </div>
  </div>
);

interface DashboardProps {
  panels: Array<{ type: string; title: string; items: ContentItemRow[] }>;
  hasLlm: boolean;
  updatedAt: string;
}

const Dashboard: FC<DashboardProps> = ({ panels, hasLlm, updatedAt }) => (
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
      <div class="grid">
        {panels.map((panel) =>
          panel.type === "digest"
            ? <DigestPanel hasLlm={hasLlm} />
            : <Panel title={panel.title} items={panel.items} />
        )}
      </div>
    </body>
  </html>
);

export function renderDashboard(props: DashboardProps): ReturnType<typeof Dashboard> {
  return Dashboard(props);
}
