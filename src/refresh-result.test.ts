import { describe, test, expect } from "bun:test";
import type { RefreshResult } from "./refresh-result";
import {
  collectRefreshFailures,
  formatRefreshPanelFailureBody,
  formatRefreshSourceFailure,
  formatRefreshSourceFailureFromError,
} from "./refresh-result";

describe("refresh result helpers", () => {
  test("formatRefreshSourceFailure includes error detail when present", () => {
    expect(formatRefreshSourceFailure("reddit", "boom")).toBe("reddit: boom");
    expect(formatRefreshSourceFailure("reddit")).toBe("reddit");
  });

  test("formatRefreshSourceFailureFromError uses errorMessage contract", () => {
    expect(formatRefreshSourceFailureFromError("reddit", new Error("boom"))).toBe("reddit: boom");
    expect(formatRefreshSourceFailureFromError("reddit", "plain")).toBe("reddit: plain");
  });

  test("collectRefreshFailures keeps only failed refresh results", () => {
    const results = [
      { kind: "adapter", name: "ok", status: "ok" },
      { kind: "adapter", name: "skip", status: "skipped" },
      { kind: "adapter", name: "bad", status: "failed", error: "boom" },
    ] satisfies RefreshResult[];

    expect(collectRefreshFailures(results)).toEqual([
      { kind: "adapter", name: "bad", status: "failed", error: "boom" },
    ]);
  });

  test("formatRefreshPanelFailureBody joins multiple source failures", () => {
    const failures = [
      { kind: "adapter", name: "reddit", status: "failed", error: "boom" },
      { kind: "pipeline", name: "merge", status: "failed", error: "timeout" },
    ] satisfies RefreshResult[];

    expect(formatRefreshPanelFailureBody(failures)).toBe(
      "Refresh failed for reddit: boom; merge: timeout",
    );
  });
});