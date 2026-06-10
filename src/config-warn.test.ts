import { describe, test, expect, spyOn, afterEach } from "bun:test";
import { warnConfig, warnUnsetEnvVar } from "./config-warn";

describe("config warn utilities", () => {
  let warnSpy: ReturnType<typeof spyOn>;

  afterEach(() => {
    warnSpy?.mockRestore();
  });

  test("warnConfig prefixes message with config module name", () => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    warnConfig("custom operational warning");
    expect(warnSpy).toHaveBeenCalledWith("config: custom operational warning");
  });

  test("warnUnsetEnvVar uses unset expansion contract", () => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    const warned = new Set<string>();
    warnUnsetEnvVar("MISSING_KEY", warned);
    expect(warnSpy).toHaveBeenCalledWith(
      "config: env var MISSING_KEY is unset (expanding to empty)",
    );
  });

  test("warnUnsetEnvVar dedupes per env var name within one expansion pass", () => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    const warned = new Set<string>();
    warnUnsetEnvVar("DUP_KEY", warned);
    warnUnsetEnvVar("DUP_KEY", warned);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});