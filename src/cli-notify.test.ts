import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import {
  buildNotifyTestPayload,
  describeNotifyRuleCriteria,
  formatNotifyTestReport,
  formatNotifyUsage,
  runNotifyTest,
  selectNotifyTestRules,
} from "./cli-notify";
import type { NotifyRuleConfig } from "./config/types";
import { runCli } from "./test/cli-runner";

function rule(overrides: Partial<NotifyRuleConfig> = {}): NotifyRuleConfig {
  return { url: "https://hooks.example.com/pace", min_score: 7, ...overrides };
}

function fetchStub(status = 200) {
  const calls: { url: string; body: unknown }[] = [];
  const fetchImpl = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return new Response("ok", { status });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

describe("selectNotifyTestRules", () => {
  test("returns all rules when no label is given", () => {
    const rules = [rule({ name: "a" }), rule({ name: "b" })];
    expect(selectNotifyTestRules(rules)).toEqual(rules);
  });

  test("filters to the rule whose label matches (name, or url when unnamed)", () => {
    const named = rule({ name: "alerts" });
    const unnamed = rule({ url: "https://other.example.com/hook" });
    expect(selectNotifyTestRules([named, unnamed], "alerts")).toEqual([named]);
    expect(selectNotifyTestRules([named, unnamed], "https://other.example.com/hook")).toEqual([
      unnamed,
    ]);
  });

  test("throws when config has no rules", () => {
    expect(() => selectNotifyTestRules(undefined)).toThrow("no notify rules configured");
    expect(() => selectNotifyTestRules([])).toThrow("no notify rules configured");
  });

  test("throws with available labels when the name matches nothing", () => {
    expect(() => selectNotifyTestRules([rule({ name: "alerts" })], "nope")).toThrow(
      'notify: no rule named "nope" (configured: "alerts")',
    );
  });
});

describe("buildNotifyTestPayload", () => {
  test("matches the real delivery shape, marked as a test", () => {
    const now = new Date("2026-08-19T00:00:00.000Z");
    const payload = buildNotifyTestPayload(rule({ name: "alerts", keywords: ["gpu"] }), now);
    expect(payload.rule).toBe("alerts");
    expect(payload.matched).toBe(1);
    expect(payload.items).toHaveLength(1);
    const item = payload.items[0];
    expect(item.title).toContain("pace notify test");
    expect(item.title).toContain('"alerts"');
    expect(item.source).toBe("pace notify test");
    expect(item.panel).toBe("notify-test");
    expect(item.timestamp).toBe("2026-08-19T00:00:00.000Z");
    expect(item.score).toBe(7);
    expect(item.summary).toContain("score >= 7");
    expect(item.summary).toContain("keywords: gpu");
  });

  test("score is null for keyword-only rules", () => {
    const payload = buildNotifyTestPayload(rule({ min_score: undefined, keywords: ["ai"] }));
    expect(payload.items[0].score).toBeNull();
  });
});

describe("describeNotifyRuleCriteria", () => {
  test("joins configured criteria", () => {
    expect(
      describeNotifyRuleCriteria(rule({ min_score: 8, keywords: ["a", "b"], panels: ["news"] })),
    ).toBe("score >= 8; keywords: a, b; panels: news");
    expect(describeNotifyRuleCriteria(rule())).toBe("score >= 7");
  });
});

describe("runNotifyTest", () => {
  test("delivers a sample payload per rule, in config order", async () => {
    const stub = fetchStub();
    const results = await runNotifyTest([rule({ name: "one" }), rule({ name: "two" })], {
      fetchImpl: stub.fetchImpl,
    });
    expect(results.map((r) => [r.rule, r.ok, r.detail])).toEqual([
      ["one", true, "200"],
      ["two", true, "200"],
    ]);
    expect(stub.calls.map((c) => (c.body as { rule: string }).rule)).toEqual(["one", "two"]);
  });

  test("sends the rule's custom headers, like real deliveries", async () => {
    const seen: Record<string, string>[] = [];
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      seen.push(init?.headers as Record<string, string>);
      return new Response("ok", { status: 200 });
    }) as typeof fetch;
    await runNotifyTest([rule({ headers: { Authorization: "Bearer tk_test" } })], { fetchImpl });
    expect(seen[0]["Authorization"]).toBe("Bearer tk_test");
    expect(seen[0]["Content-Type"]).toBe("application/json");
  });

  test("reports non-2xx and thrown fetches as failures without throwing", async () => {
    const bad = fetchStub(500);
    expect((await runNotifyTest([rule()], { fetchImpl: bad.fetchImpl }))[0]).toMatchObject({
      ok: false,
      detail: "webhook responded 500",
    });
    const throwing = (async () => {
      throw new Error("connect refused");
    }) as unknown as typeof fetch;
    expect((await runNotifyTest([rule()], { fetchImpl: throwing }))[0]).toMatchObject({
      ok: false,
      detail: "connect refused",
    });
  });
});

describe("formatNotifyTestReport", () => {
  test("all-ok report", () => {
    const report = formatNotifyTestReport([
      { rule: "a", url: "https://x.example.com", ok: true, detail: "200" },
    ]);
    expect(report.ok).toBe(true);
    expect(report.lines).toEqual([
      'notify: rule "a" - test delivery ok (200) -> https://x.example.com',
      "notify: 1 rule tested, all deliveries succeeded",
    ]);
  });

  test("failure report flips ok and counts failures", () => {
    const report = formatNotifyTestReport([
      { rule: "a", url: "https://x.example.com", ok: true, detail: "200" },
      { rule: "b", url: "https://y.example.com", ok: false, detail: "webhook responded 500" },
    ]);
    expect(report.ok).toBe(false);
    expect(report.lines[1]).toContain("FAILED (webhook responded 500)");
    expect(report.lines[2]).toBe("notify: 2 rules tested, 1 delivery(ies) failed");
  });
});

describe("formatNotifyUsage", () => {
  test("documents the command and options", () => {
    const usage = formatNotifyUsage();
    expect(usage).toContain("pace notify test [rule]");
    expect(usage).toContain("--config");
    expect(usage).toContain("--preset");
  });
});

describe("pace notify CLI", () => {
  function withTempDir(fn: (dir: string) => void): void {
    const dir = mkdtempSync(join(os.tmpdir(), "pace-notify-test-"));
    try {
      fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  function configYaml(notifyBlock: string): string {
    return `adapters:
  - name: news
    type: rss
    params:
      urls:
        - https://example.com/rss
layout:
  direction: row
  children:
    - panel: news
      source: news
${notifyBlock}`;
  }

  test("delivers a test payload end-to-end to a local webhook", async () => {
    // The receiving server must live in its own process: runCli spawns
    // synchronously, which blocks this process's event loop, so an in-process
    // Bun.serve could never answer the CLI's webhook POST.
    const dir = mkdtempSync(join(os.tmpdir(), "pace-notify-test-"));
    const portFile = join(dir, "port");
    const bodyFile = join(dir, "body.json");
    writeFileSync(
      join(dir, "server.ts"),
      `const server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch: async (req) => {
          await Bun.write(${JSON.stringify(bodyFile)}, await req.text());
          return new Response("ok");
        },
      });
      await Bun.write(${JSON.stringify(portFile)}, String(server.port));
      `,
    );
    const server = Bun.spawn([process.execPath, join(dir, "server.ts")]);
    try {
      let port: string | undefined;
      for (let i = 0; i < 100 && port === undefined; i++) {
        try {
          port = readFileSync(portFile, "utf-8");
        } catch {
          await Bun.sleep(50);
        }
      }
      expect(port).toBeDefined();
      writeFileSync(
        join(dir, "config.yaml"),
        configYaml(`notify:
  - name: alerts
    url: http://127.0.0.1:${port}/hook
    min_score: 5
`),
      );
      const res = runCli(["notify", "test", "--config", join(dir, "config.yaml")]);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain('rule "alerts" - test delivery ok (200)');
      expect(res.stdout).toContain("1 rule tested, all deliveries succeeded");
      const received = JSON.parse(readFileSync(bodyFile, "utf-8"));
      expect(received).toMatchObject({ rule: "alerts", matched: 1 });
      expect(received.items[0].source).toBe("pace notify test");
    } finally {
      server.kill();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("exits 1 when the webhook is unreachable", () => {
    withTempDir((dir) => {
      writeFileSync(
        join(dir, "config.yaml"),
        configYaml(`notify:
  - url: http://127.0.0.1:9/hook
    min_score: 5
`),
      );
      const res = runCli(["notify", "test", "--config", join(dir, "config.yaml")]);
      expect(res.status).toBe(1);
      expect(res.stdout).toContain("test delivery FAILED");
    });
  });

  test("errors clearly when the config has no notify rules", () => {
    withTempDir((dir) => {
      writeFileSync(join(dir, "config.yaml"), configYaml(""));
      const res = runCli(["notify", "test", "--config", join(dir, "config.yaml")]);
      expect(res.status).toBe(1);
      expect(res.stderr).toContain("no notify rules configured");
    });
  });

  test("rejects unknown subcommands and extra arguments", () => {
    const none = runCli(["notify"]);
    expect(none.status).toBe(1);
    expect(none.stderr).toContain("Unknown subcommand: (none)");
    const extra = runCli(["notify", "test", "a", "b"]);
    expect(extra.status).toBe(1);
    expect(extra.stderr).toContain("Unknown argument: b");
  });

  test("rejects serve-only options", () => {
    const res = runCli(["notify", "test", "--port", "8080"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("Unknown option(s) for this command: --port");
  });
});
