import { describe, test, expect } from "bun:test";
import {
  expectDashboardRefreshAction,
  expectRefreshPanelFailure,
  expectRefreshPanelFailureOrRedirect,
  expectRefreshPanelNotFound,
  expectRefreshPanelRedirect,
  expectSecurityHeaders,
  responseHeadersToLowercase,
} from "./server-harness";
import { SECURITY_HEADERS } from "../server/security-headers";

describe("server-harness security header helpers", () => {
  test("responseHeadersToLowercase normalizes mixed-case header records", () => {
    expect(responseHeadersToLowercase({ "X-Frame-Options": "DENY" })).toEqual({
      "x-frame-options": "DENY",
    });
  });

  test("expectSecurityHeaders asserts SECURITY_HEADERS contract on Response", () => {
    const headers = new Headers(SECURITY_HEADERS);
    expectSecurityHeaders(new Response(null, { headers }));
  });

  test("expectSecurityHeaders asserts SECURITY_HEADERS contract on header record", () => {
    const lower: Record<string, string> = {};
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      lower[name.toLowerCase()] = value;
    }
    expectSecurityHeaders(lower);
  });
});

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