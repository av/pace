/** @jsx jsx */
import { jsx } from "hono/jsx";
import type { FC } from "hono/jsx";
import type { FlexContainerConfig, LayoutNodeConfig } from "../config";
import { isPanel } from "../config";
import { flexContainerStyle } from "./flex-styles";
import { Panel, type PanelData } from "./panel";

export const LayoutNode: FC<{ node: LayoutNodeConfig; panelData: Map<string, PanelData> }> = ({ node, panelData }) => {
  if (isPanel(node)) {
    return <Panel node={node} panelData={panelData} />;
  }

  const container = node as FlexContainerConfig;
  return (
    <div
      class="flex-container"
      style={flexContainerStyle(container)}
    >
      {container.children.map((child) => (
        <LayoutNode node={child} panelData={panelData} />
      ))}
    </div>
  );
};