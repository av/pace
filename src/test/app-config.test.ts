import { describe, test, expect } from "bun:test";
import {
  adapterAndPipelinePanelsLayout,
  adapterPipelineLayout,
  DOMAIN_TEST_LAYOUT,
  singlePanelLayout,
  testAppConfig,
  testAppLayout,
} from "./app-config";

describe("test app-config helpers", () => {
  test("testAppLayout builds multi-panel layout with optional fields omitted", () => {
    const layout = testAppLayout(
      adapterPipelineLayout("srcA", "merge", { adapterId: "panelA", outId: "outPanel" }),
    );
    expect(layout).toEqual({
      direction: "column",
      children: [
        { panel: "a", source: "srcA", id: "panelA" },
        { panel: "out", source: "merge", id: "outPanel" },
      ],
    });
  });

  test("singlePanelLayout and adapterAndPipelinePanelsLayout presets compose testAppConfig", () => {
    const config = testAppConfig(
      { adapters: [{ type: "test", name: "testsrc", refresh_interval: 60 }] },
      adapterAndPipelinePanelsLayout("testsrc", "p1"),
    );
    expect(config.layout).toEqual({
      direction: "column",
      children: [
        { panel: "src", source: "testsrc", id: "panelP" },
        { panel: "pipe", source: "p1" },
      ],
    });
  });

  test("DOMAIN_TEST_LAYOUT remains single-panel pipeline output preset", () => {
    const config = testAppConfig({}, DOMAIN_TEST_LAYOUT);
    expect(config.layout).toEqual(
      testAppLayout(singlePanelLayout("out", "merge", { id: "outPanel", limit: 50, direction: "column" })),
    );
  });
});