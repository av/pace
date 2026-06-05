import type { AppConfig, LayoutDirection } from "../config";

export interface TestAppConfigLayout {
  direction: LayoutDirection;
  panel: string;
  source: string;
  limit?: number;
}

/** Default layout for scheduler integration tests (mirrors config defaultConfig). */
export const SCHEDULER_TEST_LAYOUT: TestAppConfigLayout = {
  direction: "row",
  panel: "all",
  source: "all",
  limit: 50,
};

/** Layout preset for domain/pipeline integration tests. */
export const DOMAIN_TEST_LAYOUT: TestAppConfigLayout = {
  direction: "column",
  panel: "out",
  source: "merge",
  limit: 50,
};

export function testAppConfig(
  overrides: Partial<AppConfig> = {},
  layout: TestAppConfigLayout = SCHEDULER_TEST_LAYOUT,
): AppConfig {
  const { direction, panel, source, limit = 50 } = layout;
  return {
    adapters: [],
    layout: { direction, children: [{ panel, source, limit }] },
    ...overrides,
  };
}