import { describe, expect, test } from "bun:test";
import type { AdapterConfig } from "../adapters/types";
import type { LayoutNodeConfig } from "../layout/types";
import {
  DEDUPE_STRATEGIES,
  KEYWORD_SCORE_ENTRY_FIELDS,
  TRANSFORM_FIELD_KEYS,
  TRANSFORM_TYPES,
  transformAllowedFieldKeys,
  type AppConfig,
  type IngestAdapterConfig,
  type TransformConfig,
  type TransformType,
} from "./types";

type AssertTransformTypesAlign =
  TransformConfig["type"] extends TransformType
    ? TransformType extends TransformConfig["type"]
      ? true
      : ["TRANSFORM_FIELD_KEYS has extra transform type"]
    : ["TransformConfig has extra transform type"];

declare const _transformTypesDriftGuard: AssertTransformTypesAlign;

describe("config/types unified surface", () => {
  test("exports transform schema and config shapes from one import", () => {
    expect(TRANSFORM_TYPES).toContain("dedupe");
    expect(KEYWORD_SCORE_ENTRY_FIELDS).toEqual(["term", "weight", "regex"]);
    expect(transformAllowedFieldKeys("latest")).toEqual(["type", "count"]);
    expect(TRANSFORM_FIELD_KEYS.dedupe).toContain("strategy");
    expect(DEDUPE_STRATEGIES).toContain("url");

    const transform: TransformConfig = { type: "latest", count: 5 };
    expect(transform.count).toBe(5);
  });

  test("exports ingest adapter config extending adapter fetch contract", () => {
    const adapterCfg: AdapterConfig = { type: "rss", params: { urls: ["https://ex.com/feed"] } };
    const ingest: IngestAdapterConfig = {
      ...adapterCfg,
      name: "rss",
      refresh_interval: 30,
      transforms: [{ type: "latest", count: 10 }],
    };
    expect(ingest.refresh_interval).toBe(30);
    expect(ingest.transforms?.[0]?.type).toBe("latest");
  });

  test("exports layout config types for AppConfig composition", () => {
    const layout: LayoutNodeConfig = { panel: "all", source: "all", limit: 25 };
    const config: AppConfig = { adapters: [], layout };
    expect(config.layout).toEqual(layout);
  });
});