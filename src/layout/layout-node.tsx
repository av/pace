/** @jsx jsx */
import { jsx } from "hono/jsx";
import type { FC } from "hono/jsx";
import type { FlexContainerConfig, ImageWidgetConfig, TextWidgetConfig, IframeWidgetConfig, LayoutNodeConfig, PanelData } from "./types";
import { isImageWidget, isTextWidget, isIframe, isPanel, isContainer } from "./types";
import { flexContainerStyle } from "./flex-styles";
import { Panel } from "./panel";

const flexStyle = (flex?: number) => (flex ? `flex:${flex}` : undefined);

const ImageWidgetPlaceholder: FC<{ node: ImageWidgetConfig }> = ({ node }) => (
  <div class="image-widget" style={flexStyle(node.flex)} />
);

const TextWidgetPlaceholder: FC<{ node: TextWidgetConfig }> = ({ node }) => (
  <div class="text-widget" style={flexStyle(node.flex)} />
);

const IframeWidgetPlaceholder: FC<{ node: IframeWidgetConfig }> = ({ node }) => (
  <div class="iframe-panel" style={flexStyle(node.flex)} />
);

export const LayoutNode: FC<{ node: LayoutNodeConfig; panelData: Map<string, PanelData> }> = ({ node, panelData }) => {
  if (isImageWidget(node)) return <ImageWidgetPlaceholder node={node} />;
  if (isTextWidget(node)) return <TextWidgetPlaceholder node={node} />;
  if (isIframe(node)) return <IframeWidgetPlaceholder node={node} />;

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