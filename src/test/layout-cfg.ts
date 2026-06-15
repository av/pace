import type { FlexContainerConfig, LayoutNodeConfig, PanelConfig, SourceValue, TextWidgetConfig } from "../config/types";

export function panelCfg(
  panel: string,
  source: SourceValue,
  extra?: Partial<Omit<PanelConfig, "panel" | "source">>,
): PanelConfig {
  return { panel, source, ...extra };
}

export function flexCfg(
  direction: FlexContainerConfig["direction"],
  children: LayoutNodeConfig[],
  extra?: Partial<Omit<FlexContainerConfig, "direction" | "children">>,
): FlexContainerConfig {
  return { direction, children, ...extra };
}

export function textCfg(
  text: string,
  format?: TextWidgetConfig["format"],
  extra?: Partial<Omit<TextWidgetConfig, "text" | "format">>,
): TextWidgetConfig {
  return { text, ...(format !== undefined && { format }), ...extra };
}