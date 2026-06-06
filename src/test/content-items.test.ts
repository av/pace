import { test, expect } from "bun:test";
import { makeContentItem, makeContentItemRow } from "./content-items";

test("makeContentItem applies id-derived defaults and allows overrides", () => {
  const item = makeContentItem({ id: "abc", title: "Custom" });
  expect(item.id).toBe("abc");
  expect(item.title).toBe("Custom");
  expect(item.url).toBe("https://ex.com/abc");
  expect(item.source).toBe("testsrc");
  expect(item.timestamp).toBeInstanceOf(Date);
});

test("makeContentItemRow fills row metadata and preserves explicit fields", () => {
  const row = makeContentItemRow({
    id: "r1",
    panel_id: "pid",
    summary: "sum",
    body: "body",
  });
  expect(row.id).toBe("r1");
  expect(row.panel_id).toBe("pid");
  expect(row.summary).toBe("sum");
  expect(row.body).toBe("body");
  expect(makeContentItemRow().body).toBe("Default body content here.");
  expect(row.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(row.fetched_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
});