import type { SourcePanelMap } from "../scheduler";

export function emptyPanelMap(): SourcePanelMap {
  return { sourceToPanels: new Map(), sourceToReadKey: new Map() };
}

export function panelMap(
  panels: Record<string, string[]>,
  readKeys: Record<string, string> = {}
): SourcePanelMap {
  return {
    sourceToPanels: new Map(Object.entries(panels)),
    sourceToReadKey: new Map(Object.entries(readKeys)),
  };
}