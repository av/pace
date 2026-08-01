/** @jsxImportSource hono/jsx */
import type { FC } from "hono/jsx";
import { raw } from "hono/utils/html";
import type { DashboardRenderMode, TextWidgetConfig } from "./types";
import { flexStyle } from "./flex-styles";
import { renderMarkdown, renderPlain, renderStaticRichText, sanitize } from "./text-render";

export const TextWidget: FC<{ node: TextWidgetConfig; mode?: DashboardRenderMode }> = ({ node, mode = "interactive" }) => {
  const format = node.format ?? "plain";
  const rendered = format === "plain"
    ? renderPlain(node.text)
    : format === "markdown"
      ? renderMarkdown(node.text)
      : sanitize(node.text);
  const content = mode === "static" && format !== "plain"
    ? renderStaticRichText(rendered)
    : rendered;

  return (
    <div class="flex-panel" style={flexStyle(node.flex)}>
      <div class="panel text-widget">
        {node.title && (
          <div class="panel-header">
            <h2 title={node.title}>{node.title}</h2>
          </div>
        )}
        <div class="text-widget-body" tabindex={0} role="region" aria-label={node.title ?? "Text content"}>
          {raw(content)}
        </div>
      </div>
    </div>
  );
};
