/** @jsxImportSource hono/jsx */
import type { FC } from "hono/jsx";
import type { DashboardRenderMode, LayoutNodeConfig, PanelData } from "./types";
import { LayoutNode } from "./layout-node";
import { faviconHref, THEME_COLORS } from "../dashboard.js";

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
  /** "error" renders the notice as an alert (refresh failure); default "info". */
  noticeTone?: "info" | "error";
  /**
   * Whether opening an item's title link auto-marks it seen (default true;
   * server.auto_mark_seen). False stamps data-auto-seen="off" on <body> so
   * the client module keeps read state fully manual.
   */
  autoMarkSeen?: boolean;
  /**
   * Whether the page starts with hide-seen mode on when the visitor has no
   * stored preference (default false; server.hide_seen). True stamps
   * data-hide-seen="on" on <body> so the client module hides seen items on
   * first visit; a persisted Shift+X choice always wins over the stamp.
   */
  hideSeenDefault?: boolean;
}

const Dashboard: FC<DashboardProps> = ({ layout, panelData, updatedAt, cssHref, mode = "interactive", basePath = "", notice, noticeTone = "info", autoMarkSeen = true, hideSeenDefault = false }) => (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      {/* Mobile browser chrome (address bar, task switcher card) matches the
          palette: the media pair follows the OS on static/no-JS pages, and
          the client module pins both to the active theme after a "t" toggle. */}
      <meta name="theme-color" media="(prefers-color-scheme: light)" content={THEME_COLORS.light} />
      <meta name="theme-color" content={THEME_COLORS.dark} />
      <title>pace</title>
      <link rel="stylesheet" href={cssHref ?? `${basePath}/styles.css`} />
      {/* Interactive: the server-served plain monogram (the client swaps the
          href for the unread-dot rendering). Static exports have no server,
          so they embed the same icon as a self-contained data: URL. */}
      <link
        rel="icon"
        type="image/svg+xml"
        href={mode === "interactive" ? `${basePath}/favicon.svg` : faviconHref(0)}
      />
      {/* Interactive pages are installable as a standalone app; static
          exports are self-contained files with no server to serve a
          manifest against, so they never link one. */}
      {mode === "interactive" && (
        <link rel="manifest" href={`${basePath}/manifest.webmanifest`} />
      )}
      {/* Keyboard navigation is a progressive enhancement, so it only loads
          in interactive mode — static exports have no server to refresh
          against and must stay self-contained. Modules defer natively and
          satisfy the CSP's default-src 'self' (inline scripts are blocked). */}
      {mode === "interactive" && <script type="module" src={`${basePath}/dashboard.js`}></script>}
    </head>
    <body
      class={mode === "static" ? "static-dashboard" : undefined}
      data-auto-seen={autoMarkSeen === false ? "off" : undefined}
      /* Hide-seen is client state, so the stamp only carries the config's
         first-visit default; static exports have no client module (or seen
         state) to act on it, so they never render the attribute. */
      data-hide-seen={hideSeenDefault === true && mode === "interactive" ? "on" : undefined}
      /* The client's offline banner names the render it is showing from this
         stamp; static exports have no service worker (or client module) to
         serve a stale copy, so they never carry it. */
      data-updated-at={mode === "interactive" ? updatedAt : undefined}
    >
      {notice ? (
        <div
          class={noticeTone === "error" ? "refresh-notice refresh-notice-error" : "refresh-notice"}
          role={noticeTone === "error" ? "alert" : "status"}
          style={
            noticeTone === "error"
              ? "padding:0.5rem 1rem;font-size:0.85rem;color:#b94a48;"
              : "padding:0.5rem 1rem;font-size:0.85rem;opacity:0.8;"
          }
        >
          {notice}
        </div>
      ) : null}
      <main class="flex-root">
        <h1 class="sr-only">pace</h1>
        <LayoutNode node={layout} panelData={panelData} mode={mode} basePath={basePath} />
      </main>
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
