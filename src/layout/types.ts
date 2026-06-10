/**
 * Unified import surface for server and layout modules.
 * Adapter contracts: adapters/types. Layout config/runtime: layout/domain. Persistence shapes: db.
 */
export type { Adapter, AdapterConfig, ContentItem, ContentItemFields } from "../adapters/types";

export type {
  DashboardPanel,
  FlexContainerConfig,
  LayoutDirection,
  LayoutNodeConfig,
  LayoutRuntimeMaps,
  PanelConfig,
  SourceConfig,
  SourceValue,
} from "./domain";

export {
  LAYOUT_DIRECTIONS,
  allPanelRefreshSourceNames,
  buildLayoutRuntimeMaps,
  collectPanels,
  isContainer,
  isPanel,
  isRecord,
  normalizeSource,
  resolvePanelId,
  resolvePanelRefreshSourceNames,
} from "./domain";

export type { ContentItemRow, DashboardPanelSnapshot } from "../db";

/** Panel render payload keyed by panel display name in dashboard maps. */
export type PanelData = DashboardPanelSnapshot;