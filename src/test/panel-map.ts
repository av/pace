import { buildLayoutRuntimeMaps, type AppConfig, type LayoutNodeConfig } from "../config/types";
import { getAdapterName } from "../utils";
import type { SourcePanelMap } from "../scheduler";

export function emptyPanelMap(): SourcePanelMap {
  return { sourceToPanels: new Map(), sourceToReadKey: new Map() };
}

/** Derive scheduler SourcePanelMap from layout config (same path as index.ts). */
function sourcePanelMapFromLayout(
  layout: LayoutNodeConfig,
  adapterNames: readonly string[] = [],
): SourcePanelMap {
  const { sourceToPanels, sourceToReadKey } = buildLayoutRuntimeMaps(layout, adapterNames);
  return { sourceToPanels, sourceToReadKey };
}

/** Derive scheduler SourcePanelMap from a full app config. */
export function sourcePanelMapFromConfig(config: AppConfig): SourcePanelMap {
  return sourcePanelMapFromLayout(
    config.layout,
    config.adapters.map(getAdapterName),
  );
}