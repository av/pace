export const LAYOUT_DIRECTIONS = ["row", "column"] as const;
export type LayoutDirection = (typeof LAYOUT_DIRECTIONS)[number];

export interface FlexContainerConfig {
  direction: LayoutDirection;
  flex?: number;
  gap?: string;
  children: LayoutNodeConfig[];
}

export interface PanelConfig {
  panel: string;
  id?: string;
  flex?: number;
  source: SourceValue;
  limit?: number;
}

export interface ImageWidgetConfig {
  image: string;
  flex?: number;
  alt?: string;
  link?: string;
}

export interface TextWidgetConfig {
  text: string;
  flex?: number;
}

export interface IframeWidgetConfig {
  iframe: string;
  flex?: number;
  title?: string;
  sandbox?: string;
}

export type LayoutNodeConfig =
  | FlexContainerConfig
  | PanelConfig
  | ImageWidgetConfig
  | TextWidgetConfig
  | IframeWidgetConfig;

export type SourceValue = string | string[] | SourceConfig | SourceConfig[];

/** Layout panel source; only `adapter` and `params` (refresh_interval belongs on adapters[]). */
export interface SourceConfig {
  adapter: string;
  params?: Record<string, unknown>;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isPanel(node: unknown): node is PanelConfig {
  return isRecord(node) && "panel" in node;
}

export function isContainer(node: unknown): node is FlexContainerConfig {
  return isRecord(node) && "direction" in node && "children" in node;
}

export function isImageWidget(node: unknown): node is ImageWidgetConfig {
  return isRecord(node) && "image" in node;
}

export function isTextWidget(node: unknown): node is TextWidgetConfig {
  return isRecord(node) && "text" in node;
}

export function isIframe(node: unknown): node is IframeWidgetConfig {
  return isRecord(node) && "iframe" in node;
}

export function normalizeSource(source: SourceValue): SourceConfig[] {
  if (typeof source === "string") {
    return [{ adapter: source }];
  }
  if (Array.isArray(source)) {
    return source.map((s) =>
      typeof s === "string" ? { adapter: s } : s
    );
  }
  return [source];
}

export function collectPanels(node: LayoutNodeConfig): PanelConfig[] {
  if (isPanel(node)) return [node];
  if (isContainer(node)) return node.children.flatMap(collectPanels);
  return [];
}

export function resolvePanelId(panel: PanelConfig): string {
  if (panel.id) return panel.id;
  const key = JSON.stringify({ panel: panel.panel, source: panel.source, limit: panel.limit ?? null });
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(key);
  return hasher.digest("hex").slice(0, 8);
}

export interface DashboardPanel {
  panel: PanelConfig;
  pid: string;
  isAll: boolean;
}

export interface LayoutRuntimeMaps {
  sourceToPanels: Map<string, string[]>;
  sourceToReadKey: Map<string, string>;
  panelIdToSources: Map<string, SourceConfig[]>;
  panelIdToRefreshSourceNames: Map<string, string[]>;
  panelNameToId: Map<string, string>;
  dashboardPanels: DashboardPanel[];
}

export function allPanelRefreshSourceNames(
  adapterNames: readonly string[],
  pipelines: readonly { name: string }[] | undefined,
): string[] {
  const names = [...adapterNames];
  if (pipelines) {
    for (const pipeline of pipelines) names.push(pipeline.name);
  }
  return names;
}

export function resolvePanelRefreshSourceNames(
  sources: readonly { adapter: string }[],
  adapterNames: readonly string[],
  pipelines: readonly { name: string }[] | undefined,
): string[] {
  return [
    ...new Set(
      sources.flatMap((source) =>
        source.adapter === "all"
          ? allPanelRefreshSourceNames(adapterNames, pipelines)
          : [source.adapter],
      ),
    ),
  ];
}

export function buildLayoutRuntimeMaps(
  layout: LayoutNodeConfig,
  adapterNames: readonly string[],
  pipelines?: readonly { name: string }[],
): LayoutRuntimeMaps {
  const sourceToPanels = new Map<string, string[]>();
  const sourceToReadKey = new Map<string, string>();
  const panelIdToSources = new Map<string, SourceConfig[]>();
  const panelIdToRefreshSourceNames = new Map<string, string[]>();
  const panelNameToId = new Map<string, string>();
  const dashboardPanels: DashboardPanel[] = [];

  for (const panel of collectPanels(layout)) {
    const sources = normalizeSource(panel.source);
    const pid = resolvePanelId(panel);
    const isAll = sources.some((s) => s.adapter === "all");
    panelIdToSources.set(pid, sources);
    panelIdToRefreshSourceNames.set(
      pid,
      resolvePanelRefreshSourceNames(sources, adapterNames, pipelines),
    );
    panelNameToId.set(panel.panel, pid);
    dashboardPanels.push({ panel, pid, isAll });
    if (isAll) continue;
    for (const source of sources) {
      const list = sourceToPanels.get(source.adapter) ?? [];
      list.push(pid);
      sourceToPanels.set(source.adapter, list);
      if (!sourceToReadKey.has(source.adapter)) {
        sourceToReadKey.set(source.adapter, pid);
      }
    }
  }

  for (const name of adapterNames) {
    if (!sourceToPanels.has(name)) {
      sourceToPanels.set(name, [name]);
      sourceToReadKey.set(name, name);
    }
  }

  return {
    sourceToPanels,
    sourceToReadKey,
    panelIdToSources,
    panelIdToRefreshSourceNames,
    panelNameToId,
    dashboardPanels,
  };
}