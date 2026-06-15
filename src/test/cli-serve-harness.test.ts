import { describe, test, expect, spyOn, afterEach } from "bun:test";
import {
  cliServeRequestSignal,
  cliServeUrl,
  requestCliServe,
  requestCliServeDashboard,
  requestCliServeHealth,
  requestCliServeRefresh,
  type CliServeHarness,
} from "./cli-serve-harness";

describe("cli-serve-harness request helpers", () => {
  let fetchSpy: ReturnType<typeof spyOn>;

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  test("cliServeRequestSignal returns AbortSignal.timeout when available", () => {
    if (typeof AbortSignal.timeout !== "function") {
      expect(cliServeRequestSignal(1000)).toBeUndefined();
      return;
    }
    const signal = cliServeRequestSignal(1000);
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  test("requestCliServe parses json body and lowercases headers", async () => {
    fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (url: string | URL | Request, init?: RequestInit) => {
      expect(url).toBe("http://localhost:9999/health");
      expect(init?.method).toBe("GET");
      return new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "X-Frame-Options": "DENY",
        },
      });
    }) as typeof fetch);
    const result = await requestCliServe("http://localhost:9999/health");
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ status: "ok" });
    expect(result.hd["content-type"]).toContain("application/json");
    expect(result.hd["x-frame-options"]).toBe("DENY");
  });

  test("cliServeUrl normalizes paths against harness base", () => {
    const harness = { base: "http://localhost:12345" } as CliServeHarness;
    expect(cliServeUrl(harness, "/")).toBe("http://localhost:12345/");
    expect(cliServeUrl(harness, "health")).toBe("http://localhost:12345/health");
  });

  test("requestCliServeDashboard GETs root HTML", async () => {
    fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (url: string | URL | Request, init?: RequestInit) => {
      expect(url).toBe("http://localhost:12345/");
      expect(init?.method).toBe("GET");
      return new Response("<!DOCTYPE html><title>pace</title>", {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }) as typeof fetch);
    const harness = { base: "http://localhost:12345" } as CliServeHarness;
    const result = await requestCliServeDashboard(harness);
    expect(result.status).toBe(200);
    expect(String(result.body)).toContain("<title>pace</title>");
    expect(result.hd["content-type"]).toContain("text/html");
  });

  test("requestCliServeHealth GETs /health", async () => {
    fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (url: string | URL | Request) => {
      expect(url).toBe("http://localhost:12345/health");
      return new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch);
    const harness = { base: "http://localhost:12345" } as CliServeHarness;
    const result = await requestCliServeHealth(harness);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ status: "ok" });
  });

  test("requestCliServeRefresh POSTs with redirect manual", async () => {
    fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (url: string | URL | Request, init?: RequestInit) => {
      expect(url).toBe("http://localhost:12345/refresh/reddit");
      expect(init?.method).toBe("POST");
      expect(init?.redirect).toBe("manual");
      return new Response(null, {
        status: 303,
        headers: { location: "/" },
      });
    }) as typeof fetch);
    const harness = {
      base: "http://localhost:12345",
    } as CliServeHarness;
    const res = await requestCliServeRefresh(harness, "reddit");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/");
  });
});