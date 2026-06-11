import { describe, test, expect, spyOn } from "bun:test";
import * as piAi from "@mariozechner/pi-ai";
import { runPipeline } from "./transforms";
import { makeContentItemRow as makeRow } from "./test/content-items";

const fakeModel = { id: "fake" } as piAi.Model<piAi.Api>;

describe("transform-llm - llm-summarize", () => {
  test("skips rows that already have a summary", async () => {
    const completeSpy = spyOn(piAi, "complete").mockResolvedValue({
      content: [{ type: "text", text: '[{"id":"needs","summary":"Fresh summary."}]' }],
    } as Awaited<ReturnType<typeof piAi.complete>>);
    try {
      const items = [
        makeRow({ id: "has", summary: "Existing summary." }),
        makeRow({ id: "needs", summary: null }),
      ];
      const result = await runPipeline(items, [{ type: "llm-summarize" }], {
        llmModel: fakeModel,
      });
      expect(result).toEqual([
        items[0],
        { ...items[1], summary: "Fresh summary." },
      ]);
      expect(completeSpy).toHaveBeenCalledTimes(1);
    } finally {
      completeSpy.mockRestore();
    }
  });

  test("null model leaves rows unchanged", async () => {
    const items = [makeRow({ id: "a", summary: null })];
    const result = await runPipeline(items, [{ type: "llm-summarize" }], { llmModel: null });
    expect(result).toEqual(items);
  });
});