import { describe, test, expect, spyOn, afterEach } from "bun:test";
import {
  logScheduler,
  warnScheduler,
  warnRefreshFailure,
  warnPruneFailure,
} from "./scheduler-warn";

describe("scheduler warn utilities", () => {
  let warnSpy: ReturnType<typeof spyOn>;

  afterEach(() => {
    warnSpy?.mockRestore();
  });

  test("logScheduler prefixes message with scheduler module name", () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});

    logScheduler("fetched 3 items");
    expect(logSpy).toHaveBeenCalledWith("scheduler: fetched 3 items");
    logSpy.mockRestore();
  });

  test("warnScheduler prefixes message with scheduler module name", () => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    warnScheduler("custom operational warning");
    expect(warnSpy).toHaveBeenCalledWith("scheduler: custom operational warning");
  });

  test("warnRefreshFailure includes source name and error detail", () => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    warnRefreshFailure("errsrc", new Error("simulated fail"));
    expect(warnSpy).toHaveBeenCalledWith(
      "scheduler: failed to refresh errsrc: simulated fail",
    );
  });

  test("warnPruneFailure includes error detail from errorMessage", () => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    warnPruneFailure(new Error("db prune fail"));
    expect(warnSpy).toHaveBeenCalledWith("scheduler: failed to prune: db prune fail");
  });
});