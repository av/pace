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

  const containerStyle = [
    flexStyle(node.flex),
    node.height ? `height:${node.height}` : undefined,
    aspectRatio ? `aspect-ratio:${aspectRatio}` : undefined,
  ]
    .filter(Boolean)
    .join(" ");

  const iframeAttrs: Record<string, string> = {
    src: node.iframe,
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
      <div class="iframe-panel">
        <iframe {...iframeAttrs} />
      </div>
    </div>
  );
};
