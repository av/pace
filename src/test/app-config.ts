import type { AppConfig, LayoutDirection, LayoutNodeConfig } from "../config/types";

interface TestAppConfigPanel {
  panel: string;
  source: string;
  id?: string;
  limit?: number;
}

interface TestAppConfigLayout {
  direction: LayoutDirection;
  panels: TestAppConfigPanel[];
}

/** Default layout for scheduler integration tests (mirrors config defaultConfig). */
const SCHEDULER_TEST_LAYOUT: TestAppConfigLayout = {
  direction: "row",
  panels: [{ panel: "all", source: "all", limit: 50 }],
};

/** Layout preset for domain/pipeline integration tests. */
export const DOMAIN_TEST_LAYOUT: TestAppConfigLayout = {
  direction: "column",
  panels: [{ panel: "out", source: "merge", id: "outPanel", limit: 50 }],
};

export function testAppLayout(layout: TestAppConfigLayout): LayoutNodeConfig {
  return {
    direction: layout.direction,
    children: layout.panels.map(({ panel, source, id, limit }) => ({
      panel,
      source,
      ...(id ? { id } : {}),
      ...(limit !== undefined ? { limit } : {}),
    })),
  };
}

export function singlePanelLayout(
  panel: string,
  source: string,
  opts: { id?: string; limit?: number; direction?: LayoutDirection } = {},
): TestAppConfigLayout {
  const { id, limit, direction = "row" } = opts;
  return {
    direction,
    panels: [{ panel, source, ...(id ? { id } : {}), ...(limit !== undefined ? { limit } : {}) }],
  };
}

/** Adapter source panel + pipeline output panel (column). */
export function adapterPipelineLayout(
  adapterSource: string,
  pipelineName: string,
  opts: {
    adapterPanel?: string;
    adapterId?: string;
    outPanel?: string;
    outId?: string;
    direction?: LayoutDirection;
  } = {},
): TestAppConfigLayout {
  const {
    adapterPanel = "a",
    adapterId = "panelA",
    outPanel = "out",
    outId = "outPanel",
    direction = "column",
  } = opts;
  return {
    direction,
    panels: [
      { panel: adapterPanel, source: adapterSource, id: adapterId },
      { panel: outPanel, source: pipelineName, id: outId },
    ],
  };
}

/** Adapter source panel + pipeline panel without explicit output id (column). */
export function adapterAndPipelinePanelsLayout(
  adapterSource: string,
  pipelineName: string,
  opts: {
    adapterPanel?: string;
    adapterId?: string;
    pipelinePanel?: string;
  } = {},
): TestAppConfigLayout {
  const {
    adapterPanel = "src",
    adapterId = "panelP",
    pipelinePanel = "pipe",
  } = opts;
  return {
    direction: "column",
    panels: [
      { panel: adapterPanel, source: adapterSource, id: adapterId },
      { panel: pipelinePanel, source: pipelineName },
    ],
  };
}

export function testAppConfig(
  overrides: Partial<AppConfig> = {},
  layout: TestAppConfigLayout = SCHEDULER_TEST_LAYOUT,
): AppConfig {
  return {
    adapters: [],
    layout: testAppLayout(layout),
    ...overrides,
  };
}