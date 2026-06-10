import type { FlexContainerConfig, LayoutNodeConfig, PanelConfig, SourceValue } from "../config/types";

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