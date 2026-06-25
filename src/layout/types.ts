/**
 * Unified import surface for server and layout modules.
 * Adapter contracts: adapters/types. Layout config/runtime: layout/domain. Persistence shapes: db.
 */
export type { Adapter, AdapterConfig, ContentItem, ContentItemFields } from "../adapters/types";

export type {
  DashboardPanel,
  FlexContainerConfig,
  IframeWidgetConfig,
  ImageWidgetConfig,
  LayoutDirection,
  LayoutNodeConfig,
  LayoutRuntimeMaps,
  PanelConfig,
  SourceConfig,
  SourceValue,
  TextWidgetConfig,
} from "./domain";

export {
  LAYOUT_DIRECTIONS,
  allPanelRefreshSourceNames,
  buildLayoutRuntimeMaps,
  collectPanels,
  isContainer,
  isIframe,
  isImageWidget,
  isPanel,
  isRecord,
  isTextWidget,
  normalizeSource,
  resolvePanelId,
  resolvePanelRefreshSourceNames,
} from "./domain";

export type { ContentItemRow, DashboardPanelSnapshot } from "../db";

export type DashboardRenderMode = "interactive" | "static";

/**
 * Panel render payload keyed by panel display name in dashboard maps.
 * `panelId` and `lastRefreshedAt` are optional — the layout layer falls back
 * to `resolvePanelId(node)` and hides the timestamp when they are absent.
 * `DashboardPanelSnapshot` (which has all three fields required) is assignable
 * to `PanelData`, so production code passes DB snapshots unchanged.
 */
export interface PanelData {
  items: import("../db").ContentItemRow[];
  panelId?: string;
  lastRefreshedAt?: string | null;
}
