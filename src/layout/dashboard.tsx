import type { FC } from "hono/jsx";
import type { DashboardRenderMode, LayoutNodeConfig, PanelData } from "./types";
import { LayoutNode } from "./layout-node";

export type { PanelData } from "./types";

/** Format a Date as the dashboard footer "updated at" string (UTC, no T, seconds precision). */
export function formatDashboardUpdatedAt(date: Date = new Date()): string {
  return date.toISOString().replace("T", " ").slice(0, 19);
}

interface DashboardProps {
  layout: LayoutNodeConfig;
  panelData: Map<string, PanelData>;
  updatedAt: string;
  cssHref?: string;
  mode?: DashboardRenderMode;
  basePath?: string;
  notice?: string;
}

const Dashboard: FC<DashboardProps> = ({ layout, panelData, updatedAt, cssHref, mode = "interactive", basePath = "", notice }) => (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>pace</title>
      <link rel="stylesheet" href={cssHref ?? `${basePath}/styles.css`} />
    </head>
    <body>
      {notice ? (
        <div
          class="refresh-notice"
          role="status"
          style="padding:0.5rem 1rem;font-size:0.85rem;opacity:0.8;"
        >
          {notice}
        </div>
      ) : null}
      <div class="flex-root">
        <LayoutNode node={layout} panelData={panelData} mode={mode} basePath={basePath} />
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
