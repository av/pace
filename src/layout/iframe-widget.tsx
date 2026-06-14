/** @jsx jsx */
import { jsx } from "hono/jsx";
import type { FC } from "hono/jsx";
import type { IframeWidgetConfig } from "./types";
import { flexStyle } from "./flex-styles";
import { sanitizeSandboxTokens } from "../config-validate";

const DEFAULT_SANDBOX = "allow-scripts allow-same-origin";

export const IframeWidget: FC<{ node: IframeWidgetConfig }> = ({ node }) => {
  const sandbox = node.sandbox
    ? sanitizeSandboxTokens(node.sandbox, "iframe.sandbox")
    : DEFAULT_SANDBOX;

  // Sizing priority: height > aspect_ratio > default 16/9
  const aspectRatio = node.height ? undefined : (node.aspect_ratio ?? "16/9");

  // aspect-ratio goes on the iframe-panel, not the outer container, so the
  // ratio controls the content area (not including the title header).
  // height stays on the outer container so the whole widget is that tall.
  // When using aspect-ratio, the outer container must not force height:100%
  // (from .flex-panel CSS), so we override it with height:auto.
  const containerStyle = [
    flexStyle(node.flex),
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

  const iframeTitle = node.title ?? `Embedded content from ${new URL(node.iframe, "https://localhost").hostname}`;

  const iframeAttrs: Record<string, string> = {
    src: node.iframe,
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
          <h2>{node.title}</h2>
        </div>
      )}
      <div class="iframe-panel" style={iframePanelStyle} role="region" aria-label={iframeTitle}>
        <iframe {...iframeAttrs} />
      </div>
    </div>
  );
};
