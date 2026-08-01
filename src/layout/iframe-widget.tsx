/** @jsxImportSource hono/jsx */
import type { FC } from "hono/jsx";
import type { DashboardRenderMode, IframeWidgetConfig } from "./types";
import { flexStyle } from "./flex-styles";
import { isSafeEmbedUrl, sanitizeSandboxTokens } from "../config-validate";

const DEFAULT_SANDBOX = "allow-scripts allow-same-origin";

export const IframeWidget: FC<{ node: IframeWidgetConfig; mode?: DashboardRenderMode }> = ({ node, mode = "interactive" }) => {
  // Sizing priority: height > aspect_ratio > default 16/9
  const aspectRatio = node.height ? undefined : (node.aspect_ratio ?? "16/9");

  // aspect-ratio goes on the iframe-panel, not the outer container, so the
  // ratio controls the content area (not including the title header).
  // height stays on the outer container so the whole widget is that tall.
  // When using aspect-ratio, the outer container must not force height:100%
  // (from .flex-panel CSS), so we override it with height:auto.
  // When height is set without an explicit flex, use flex:none so the explicit
  // height takes effect instead of being overridden by the default flex:1
  // (whose flex-basis:0 would cause the element to ignore the height and
  // grow proportionally with siblings).
  const effectiveFlex = node.height && node.flex === undefined ? 0 : node.flex;
  const containerStyle = [
    flexStyle(effectiveFlex),
    node.height ? `height:${node.height}` : undefined,
    aspectRatio ? "height:auto" : undefined,
  ]
    .filter(Boolean)
    .join(" ");

  // When using aspect-ratio, the iframe-panel must not flex-grow (which would
  // override the ratio). flex:none lets it size based on aspect-ratio alone.
  const iframePanelStyle = aspectRatio
    ? `aspect-ratio:${aspectRatio}; flex:none`
    : undefined;

  // Render-time guard: config validation enforces this for YAML configs, but
  // programmatic AppConfig can reach the renderer unvalidated. Never emit an
  // iframe src with a disallowed scheme (javascript:, data:, ...) and never
  // let an unparseable URL throw mid-render (new URL below) and 500 the whole
  // dashboard.
  const safeSrc = isSafeEmbedUrl(node.iframe) ? node.iframe : null;
  if (safeSrc === null) {
    console.warn(`layout: iframe src blocked (disallowed scheme or invalid URL): ${node.iframe}`);
    return (
      <div class="flex-panel" style={containerStyle}>
        {node.title && (
          <div class="panel-header">
            <h2 title={node.title}>{node.title}</h2>
          </div>
        )}
        <div class="iframe-panel" style={iframePanelStyle} role="region" aria-label={node.title ?? "Embedded content"}>
          <p>Embedded content blocked: URL is not an allowed https/localhost address.</p>
        </div>
      </div>
    );
  }

  const iframeTitle = node.title ?? `Embedded content from ${new URL(safeSrc).hostname}`;

  if (mode === "static") {
    return (
      <div class="flex-panel" style={containerStyle}>
        {node.title && (
          <div class="panel-header">
            <h2 title={node.title}>{node.title}</h2>
          </div>
        )}
        <div
          class="iframe-panel iframe-static-placeholder"
          style={iframePanelStyle}
          role="region"
          aria-label={iframeTitle}
        >
          <p>Embedded content is not included in static snapshots.</p>
          <a href={safeSrc} target="_blank" rel="noopener noreferrer">Open embedded source</a>
        </div>
      </div>
    );
  }

  const sandbox = node.sandbox
    ? sanitizeSandboxTokens(node.sandbox, "iframe.sandbox")
    : DEFAULT_SANDBOX;

  const iframeAttrs: Record<string, string> = {
    src: safeSrc,
    title: iframeTitle,
    sandbox,
    referrerpolicy: "no-referrer",
    loading: "lazy",
  };

  if (node.allow) {
    iframeAttrs.allow = node.allow;
  }

  return (
    <div class="flex-panel" style={containerStyle}>
      {node.title && (
        <div class="panel-header">
          <h2 title={node.title}>{node.title}</h2>
        </div>
      )}
      <div class="iframe-panel" style={iframePanelStyle} role="region" aria-label={iframeTitle}>
        <iframe {...iframeAttrs} />
      </div>
    </div>
  );
};
