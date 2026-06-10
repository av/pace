/** @jsx jsx */
import { jsx } from "hono/jsx";
import type { FC } from "hono/jsx";
import type { LayoutNodeConfig } from "../config";
import { LayoutNode } from "./layout-node";
import type { PanelData } from "./panel";

export type { PanelData } from "./panel";

/** Format a Date as the dashboard footer "updated at" string (UTC, no T, seconds precision). */
export function formatDashboardUpdatedAt(date: Date = new Date()): string {
  return date.toISOString().replace("T", " ").slice(0, 19);
}

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