import { describe, test, expect } from "bun:test";
import {
  expectDashboardRefreshAction,
  expectRefreshPanelFailure,
  expectRefreshPanelFailureOrRedirect,
  expectRefreshPanelNotFound,
  expectRefreshPanelRedirect,
} from "./server-harness";

describe("server-harness refresh helpers", () => {
  test("expectDashboardRefreshAction matches encoded panel id in form action", () => {
    const html = '<form method="POST" action="/refresh/tech-panel">';
    expect(() => expectDashboardRefreshAction(html, "tech-panel")).not.toThrow();
    expect(() => expectDashboardRefreshAction(html, "other")).toThrow();
  });

  test("expectRefreshPanelNotFound uses formatUnknownRefreshPanelBody contract", async () => {
    const res = new Response("Unknown panel: missing", { status: 404 });
    await expectRefreshPanelNotFound(res, "missing");
  });

  test("expectRefreshPanelFailure uses formatRefreshPanelFailureBody contract", async () => {
    const res = new Response("Refresh failed for reddit: boom", { status: 502 });
    await expectRefreshPanelFailure(res, [
      { kind: "adapter", name: "reddit", status: "failed", error: "boom" },
    ]);
  });

  test("expectRefreshPanelRedirect asserts 303 to dashboard root", () => {
    const res = new Response(null, {
      status: 303,
      headers: { location: "/" },
    });
    expectRefreshPanelRedirect(res);
  });

  test("expectRefreshPanelFailureOrRedirect accepts 303 or 502 with source prefix", async () => {
    const redirect = new Response(null, {
      status: 303,
      headers: { location: "/" },
    });
    await expectRefreshPanelFailureOrRedirect(redirect, "reddit");

    const failure = new Response("Refresh failed for reddit: boom", { status: 502 });
    await expectRefreshPanelFailureOrRedirect(failure, "reddit");
  });
});