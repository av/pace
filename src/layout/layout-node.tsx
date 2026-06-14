/** @jsx jsx */
import { jsx } from "hono/jsx";
import type { FC } from "hono/jsx";
import type { LayoutNodeConfig, PanelData } from "./types";
import { isImageWidget, isTextWidget, isIframe, isPanel, isContainer } from "./types";
import { flexContainerStyle } from "./flex-styles";
import { Panel } from "./panel";
import { ImageWidget } from "./image-widget";
import { IframeWidget } from "./iframe-widget";
import { TextWidget } from "./text-widget";

export const LayoutNode: FC<{ node: LayoutNodeConfig; panelData: Map<string, PanelData> }> = ({ node, panelData }) => {
  if (isImageWidget(node)) return <ImageWidget node={node} />;
  if (isTextWidget(node)) return <TextWidget node={node} />;
  if (isIframe(node)) return <IframeWidget node={node} />;

  if (isPanel(node)) {
    return <Panel node={node} panelData={panelData} />;
  }

  if (isContainer(node)) {
    return (
      <div
        class="flex-container"
        style={flexContainerStyle(node)}
      >
        {node.children.map((child) => (
          <LayoutNode node={child} panelData={panelData} />
        ))}
      </div>
    );
  }

  return null;
};