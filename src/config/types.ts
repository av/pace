/**
 * Unified import surface for config and transform modules.
 * Transform schema: transform-schema. Config shapes: config/domain. Layout config: layout/types.
 */
export type { AdapterConfig } from "../adapters/types";

export {
  KEYWORD_SCORE_ENTRY_FIELDS,
  TRANSFORM_FIELD_KEYS,
  TRANSFORM_TYPES,
  transformAllowedFieldKeys,
} from "../transform-schema";
export type { KeywordScoreEntryField, TransformType } from "../transform-schema";

export {
  CLUSTER_STRATEGIES,
  DECAY_TYPES,
  DEDUPE_DEFAULT_KEEP,
  DEDUPE_DEFAULT_STRATEGY,
  DEDUPE_DEFAULT_THRESHOLD,
  DEDUPE_KEEP_OPTIONS,
  DEDUPE_STRATEGIES,
  isDedupeStrategy,
  KEYWORD_FIELDS,
  normalizeBasePath,
  SORT_DIRECTIONS,
  SORT_FIELDS,
} from "./domain";
export type {
  AppConfig,
  ClusterStrategy,
  ConfigFileReader,
  ConfigPathResolution,
  ConfigReadResult,
  DecayType,
  DedupeKeep,
  DedupeStrategy,
  IngestAdapterConfig,
  KeywordField,
  KeywordScoreEntry,
  LlmConfig,
  PipelineConfig,
  ServerConfig,
  SortDirection,
  SortField,
  TransformConfig,
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
} from "../layout/types";
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
} from "../layout/types";