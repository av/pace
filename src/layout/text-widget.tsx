/** @jsx jsx */
import { jsx } from "hono/jsx";
import type { FC } from "hono/jsx";
import { raw } from "hono/utils/html";
import type { TextWidgetConfig } from "./types";
import { flexStyle } from "./flex-styles";
import { sanitize, renderMarkdown } from "./text-render";

export const TextWidget: FC<{ node: TextWidgetConfig }> = ({ node }) => {
  const format = node.format ?? "plain";

  return (
    <div class="flex-panel" style={flexStyle(node.flex)}>
      <div class="panel text-widget">
        {node.title && (
          <div class="panel-header">
            <h2>{node.title}</h2>
          </div>
        )}
        <div class="text-widget-body">
          {format === "plain"
            ? node.text
            : raw(format === "markdown" ? renderMarkdown(node.text) : sanitize(node.text))
          }
        </div>
      </div>
    </div>
  );
};
