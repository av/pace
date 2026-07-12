import { describe, test, expect, spyOn, afterEach } from "bun:test";
import { spyConsole } from "./test/console-spy";
import {
  stripJsonCodeFences,
  safeComplete,
  createModel,
  llmCompleteTimeoutMs,
  LLM_COMPLETE_TIMEOUT_MS,
  summarizeItem,
  summarizeItems,
  mergeItems,
  filterItemsByLlm,
  lensItems,
  formatContentItemForLlm,
} from "./llm";
import * as piAi from "@mariozechner/pi-ai";
import { makeContentItem as makeItem } from "./test/content-items";

const fakeThrowingModel = { id: "fake" } as piAi.Model<piAi.Api>;

describe("llm", () => {
  describe("stripJsonCodeFences", () => {
    test("strips json fences", () => {
      const input = '```json\n[{"id":"1"}]\n```';
      expect(stripJsonCodeFences(input)).toBe('[{"id":"1"}]');
    });

    test("strips plain fences", () => {
      const input = '```\n[{"id":"2"}]\n```';
      expect(stripJsonCodeFences(input)).toBe('[{"id":"2"}]');
    });

    test("strips fences with surrounding whitespace", () => {
      const input = '\n\n```json  \n  {"foo":1}  \n```  \n';
      expect(stripJsonCodeFences(input)).toBe('{"foo":1}');
    });

    test("unchanged without fences", () => {
      const input = '[{"id":"3"}]';
      expect(stripJsonCodeFences(input)).toBe('[{"id":"3"}]');
    });

    test("empty and whitespace-only", () => {
      expect(stripJsonCodeFences("")).toBe("");
      expect(stripJsonCodeFences("   \n\t  ")).toBe("");
    });

    test("strips multiple fences", () => {
      const input = '```json\n1\n``` extra ```\n2\n```';
      expect(stripJsonCodeFences(input)).toBe("1\n extra \n2");
    });
  });

  describe("summarizeItem", () => {
    test("empty body returns null", async () => {
      const item = makeItem({ body: "" });
      const res = await summarizeItem(fakeThrowingModel, item);
      expect(res).toBe(null);
    });

    test("complete error returns null", async () => {
      const item = makeItem({ title: "Test", body: "Some content" });
      const res = await summarizeItem(fakeThrowingModel, item);
      expect(res).toBe(null);
    });
  });

  describe("summarizeItems", () => {
    test("empty list returns empty", async () => {
      const res = await summarizeItems(fakeThrowingModel, []);
      expect(res).toEqual([]);
    });

    test("passthrough on complete error", async () => {
      const items = [makeItem({ id: "a" }), makeItem({ id: "b" })];
      const res = await summarizeItems(fakeThrowingModel, items);
      expect(res).toEqual(items);
    });

    test("applies batch JSON summaries", async () => {
      const completeSpy = spyOn(piAi, "complete").mockResolvedValue({
        content: [
          {
            type: "text",
            text: '[{"id":"a","summary":"Alpha summary."},{"id":"b","summary":"Beta summary."}]',
          },
        ],
      } as Awaited<ReturnType<typeof piAi.complete>>);
      try {
        const items = [
          makeItem({ id: "a", title: "Alpha" }),
          makeItem({ id: "b", title: "Beta" }),
        ];
        const res = await summarizeItems(fakeThrowingModel, items);
        expect(res).toEqual([
          { ...items[0], summary: "Alpha summary." },
          { ...items[1], summary: "Beta summary." },
        ]);
        expect(completeSpy).toHaveBeenCalledTimes(1);
      } finally {
        completeSpy.mockRestore();
      }
    });
  });

  describe("mergeItems filterItemsByLlm lensItems", () => {
    test("mergeItems empty list", async () => {
      const res = await mergeItems(fakeThrowingModel, []);
      expect(res).toEqual([]);
    });

    test("mergeItems passthrough on error", async () => {
      const items = [makeItem({ id: "a" }), makeItem({ id: "b" })];
      const res = await mergeItems(fakeThrowingModel, items);
      expect(res).toEqual(items);
    });

    test("filterItemsByLlm empty list", async () => {
      const res = await filterItemsByLlm(fakeThrowingModel, [], "keep tech");
      expect(res).toEqual([]);
    });

    test("filterItemsByLlm passthrough on error", async () => {
      const items = [makeItem({ id: "x" })];
      const res = await filterItemsByLlm(fakeThrowingModel, items, "some criteria");
      expect(res).toEqual(items);
    });

    test("filterItemsByLlm warns on JSON parse failure", async () => {
      const completeSpy = spyOn(piAi, "complete").mockResolvedValue({
        content: [{ type: "text", text: "not valid json {{{" }],
      } as Awaited<ReturnType<typeof piAi.complete>>);
      try {
        await spyConsole(["warn"], async ({ warn: warnSpy }) => {
          const items = [makeItem({ id: "x" })];
          const res = await filterItemsByLlm(fakeThrowingModel, items, "keep tech");
          expect(res).toEqual(items);
          expect(warnSpy).toHaveBeenCalledTimes(1);
          expect(warnSpy).toHaveBeenCalledWith(
            expect.stringMatching(/^llm: JSON parse failed: /),
          );
        });
      } finally {
        completeSpy.mockRestore();
      }
    });

    test("lensItems empty inputs", async () => {
      const items = [makeItem()];
      expect(await lensItems(fakeThrowingModel, [], ["ai"])).toEqual([]);
      expect(await lensItems(fakeThrowingModel, items, [])).toEqual(items);
    });

    test("lensItems passthrough on error", async () => {
      const items = [makeItem({ id: "1", title: "one" }), makeItem({ id: "2", title: "two" })];
      const res = await lensItems(fakeThrowingModel, items, ["tech"]);
      expect(res).toEqual(items);
    });
  });

  describe("safeComplete", () => {
    test("complete error returns null", async () => {
      const ctx: piAi.Context = {
        systemPrompt: "test",
        messages: [{ role: "user", content: "hi", timestamp: Date.now() }],
      };
      const res = await safeComplete(fakeThrowingModel, ctx);
      expect(res).toBe(null);
    });

    test("warns on complete failure", async () => {
      await spyConsole(["warn"], async ({ warn: warnSpy }) => {
        const ctx: piAi.Context = {
          systemPrompt: "test",
          messages: [{ role: "user", content: "hi", timestamp: Date.now() }],
        };
        const res = await safeComplete(fakeThrowingModel, ctx);
        expect(res).toBe(null);
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringMatching(/^llm: complete failed: /),
        );
      });
    });

    test("provider response diagnostics retain status classes without reflected secrets", async () => {
      const completeSpy = spyOn(piAi, "complete")
        .mockResolvedValueOnce({
          content: [],
          stopReason: "error",
          errorMessage: "401 invalid api_key=reflected-auth-secret",
        } as unknown as Awaited<ReturnType<typeof piAi.complete>>)
        .mockResolvedValueOnce({
          content: [],
          stopReason: "error",
          errorMessage: "429 retry https://provider.test?access_token=reflected-rate-secret",
        } as unknown as Awaited<ReturnType<typeof piAi.complete>>)
        .mockResolvedValueOnce({
          content: [],
          stopReason: "error",
          errorMessage: "503 backend failed with credential=reflected-server-secret",
        } as unknown as Awaited<ReturnType<typeof piAi.complete>>);
      try {
        await spyConsole(["warn"], async ({ warn: warnSpy }) => {
          const ctx: piAi.Context = {
            systemPrompt: "test",
            messages: [{ role: "user", content: "hi", timestamp: Date.now() }],
          };
          expect(await safeComplete(fakeThrowingModel, ctx)).toBe(null);
          expect(await safeComplete(fakeThrowingModel, ctx)).toBe(null);
          expect(await safeComplete(fakeThrowingModel, ctx)).toBe(null);
          expect(warnSpy.mock.calls.map((call: unknown[]) => call[0])).toEqual([
            "llm: complete failed: provider authentication failed (HTTP 401)",
            "llm: complete failed: provider rate limited request (HTTP 429)",
            "llm: complete failed: provider server error (HTTP 503)",
          ]);
          expect(warnSpy.mock.calls.flat().join(" ")).not.toContain("reflected-");
        });
      } finally {
        completeSpy.mockRestore();
      }
    });

    test("provider response diagnostics report malformed responses containing no text", async () => {
      const completeSpy = spyOn(piAi, "complete").mockResolvedValue({
        content: [],
        stopReason: "stop",
      } as unknown as Awaited<ReturnType<typeof piAi.complete>>);
      try {
        await spyConsole(["warn"], async ({ warn: warnSpy }) => {
          const ctx: piAi.Context = {
            systemPrompt: "test",
            messages: [{ role: "user", content: "hi", timestamp: Date.now() }],
          };
          expect(await safeComplete(fakeThrowingModel, ctx)).toBe(null);
          expect(warnSpy).toHaveBeenCalledWith("llm: complete returned no text");
        });
      } finally {
        completeSpy.mockRestore();
      }
    });

    test("provider response diagnostics sanitize thrown provider errors", async () => {
      const completeSpy = spyOn(piAi, "complete").mockRejectedValue(
        new Error("429 api_key=thrown-secret https://provider.test?token=thrown-secret"),
      );
      try {
        await spyConsole(["warn"], async ({ warn: warnSpy }) => {
          const ctx: piAi.Context = {
            systemPrompt: "test",
            messages: [{ role: "user", content: "hi", timestamp: Date.now() }],
          };
          expect(await safeComplete(fakeThrowingModel, ctx)).toBe(null);
          expect(warnSpy).toHaveBeenCalledWith(
            "llm: complete failed: provider rate limited request (HTTP 429)",
          );
          expect(warnSpy.mock.calls.flat().join(" ")).not.toContain("thrown-secret");
        });
      } finally {
        completeSpy.mockRestore();
      }
    });

    test("passes an abort signal with a timeout to complete", async () => {
      const completeSpy = spyOn(piAi, "complete").mockResolvedValue({
        content: [{ type: "text", text: "ok" }],
      } as Awaited<ReturnType<typeof piAi.complete>>);
      try {
        const ctx: piAi.Context = {
          systemPrompt: "test",
          messages: [{ role: "user", content: "hi", timestamp: Date.now() }],
        };
        const res = await safeComplete(fakeThrowingModel, ctx);
        expect(res).toBe("ok");
        const options = completeSpy.mock.calls[0][2] as piAi.StreamOptions | undefined;
        expect(options?.signal).toBeInstanceOf(AbortSignal);
        expect(options?.signal?.aborted).toBe(false);
      } finally {
        completeSpy.mockRestore();
      }
    });

    test("hung provider that honors the signal times out to null with a warn", async () => {
      const completeSpy = spyOn(piAi, "complete").mockImplementation(
        (_model, _ctx, options) =>
          new Promise((_resolve, reject) => {
            options?.signal?.addEventListener("abort", () =>
              reject(options.signal!.reason),
            );
          }),
      );
      try {
        await spyConsole(["warn"], async ({ warn: warnSpy }) => {
          const ctx: piAi.Context = {
            systemPrompt: "test",
            messages: [{ role: "user", content: "hi", timestamp: Date.now() }],
          };
          const res = await safeComplete(fakeThrowingModel, ctx, 20);
          expect(res).toBe(null);
          expect(warnSpy).toHaveBeenCalledTimes(1);
          expect(warnSpy).toHaveBeenCalledWith("llm: complete timed out after 20ms");
        });
      } finally {
        completeSpy.mockRestore();
      }
    });

    test("empty context returns null", async () => {
      const ctx: piAi.Context = {
        systemPrompt: "",
        messages: [{ role: "user", content: "", timestamp: Date.now() }],
      };
      const res = await safeComplete(fakeThrowingModel, ctx);
      expect(res).toBe(null);
    });
  });

  describe("llm.timeout_seconds", () => {
    afterEach(() => {
      // Reset process-wide timeout state for other tests.
      createModel({});
      expect(llmCompleteTimeoutMs()).toBe(LLM_COMPLETE_TIMEOUT_MS);
    });

    test("createModel sets the configured timeout and resets it when absent", () => {
      createModel({ timeout_seconds: 300 });
      expect(llmCompleteTimeoutMs()).toBe(300_000);
      createModel({});
      expect(llmCompleteTimeoutMs()).toBe(LLM_COMPLETE_TIMEOUT_MS);
    });

    test("safeComplete uses the config-provided timeout when no explicit override", async () => {
      const completeSpy = spyOn(piAi, "complete").mockImplementation(
        (_model, _ctx, options) =>
          new Promise((_resolve, reject) => {
            options?.signal?.addEventListener("abort", () =>
              reject(options.signal!.reason),
            );
          }),
      );
      try {
        createModel({ timeout_seconds: 0.02 });
        await spyConsole(["warn"], async ({ warn: warnSpy }) => {
          const ctx: piAi.Context = {
            systemPrompt: "test",
            messages: [{ role: "user", content: "hi", timestamp: Date.now() }],
          };
          const res = await safeComplete(fakeThrowingModel, ctx);
          expect(res).toBe(null);
          expect(warnSpy).toHaveBeenCalledWith("llm: complete timed out after 20ms");
        });
      } finally {
        completeSpy.mockRestore();
      }
    });
  });

  describe("formatContentItemForLlm", () => {
    test("minimal item without body", () => {
      const item = makeItem({ id: "i1", title: "Hello", source: "testsrc" });
      expect(formatContentItemForLlm(item)).toBe('- id: "i1" | title: "Hello" | source: testsrc');
    });

    test("truncates body when maxBodyLen > 0", () => {
      const item = makeItem({ id: "i2", title: "T", source: "s", body: "long body content here" });
      expect(formatContentItemForLlm(item, 10)).toBe('- id: "i2" | title: "T" | source: s | body: long body ');
    });

    test("omits body when maxBodyLen <= 0", () => {
      const item = makeItem({ id: "i3", title: "X", source: "y", body: "zzz" });
      expect(formatContentItemForLlm(item, 0)).toBe('- id: "i3" | title: "X" | source: y');
      expect(formatContentItemForLlm(item)).toBe('- id: "i3" | title: "X" | source: y');
    });

    test("empty body and special chars", () => {
      const item = makeItem({ id: 'id"q', title: "ti|tle", source: "src", body: "" });
      expect(formatContentItemForLlm(item, 5)).toBe('- id: "id"q" | title: "ti|tle" | source: src');
    });

    test("mergeItems uses formatting path", async () => {
      const items = [makeItem({ id: "m1", title: "m", body: "bb" })];
      expect(await mergeItems(fakeThrowingModel, items)).toEqual(items);
    });
  });

  describe("createModel", () => {
    test("incomplete config returns null", () => {
      expect(createModel({})).toBe(null);
      expect(createModel({ provider: "openai", model: "gpt-4" })).toBe(null);
      expect(createModel({ provider: "openai", api_key: "k" })).toBe(null);
    });

    test("warns on unknown provider", async () => {
      await spyConsole(["warn"], ({ warn: warnSpy }) => {
        const model = createModel({
          provider: "totally-unknown-provider",
          model: "custom-model-id",
          api_key: "test-key",
        });
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy).toHaveBeenCalledWith(
          "llm: unknown provider/model (totally-unknown-provider/custom-model-id), using OpenAI-compatible fallback",
        );
        expect(model).not.toBeNull();
        expect(model!.id).toBe("custom-model-id");
        expect(model!.provider).toBe("totally-unknown-provider");
        expect(model!.api).toBe("openai-completions");
        expect(model!.baseUrl).toBe("http://localhost:11434/v1");
      });
    });

    test("warns on unknown model id", async () => {
      await spyConsole(["warn"], ({ warn: warnSpy }) => {
        const model = createModel({
          provider: "openai",
          model: "__pace_test_nonexistent_model__",
          api_key: "sk-test",
        });
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy).toHaveBeenCalledWith(
          "llm: unknown provider/model (openai/__pace_test_nonexistent_model__), using OpenAI-compatible fallback",
        );
        expect(model!.id).toBe("__pace_test_nonexistent_model__");
      });
    });

    test("configured API key is passed explicitly for a custom provider", async () => {
      const completeSpy = spyOn(piAi, "complete").mockResolvedValue({
        content: [{ type: "text", text: "ok" }],
        stopReason: "stop",
      } as unknown as Awaited<ReturnType<typeof piAi.complete>>);
      try {
        await spyConsole(["warn"], async () => {
          const model = createModel({
            provider: "custom-openai-compatible",
            model: "custom-model",
            api_key: "pace-config-only-secret",
            base_url: "http://localhost:11434/v1",
          });
          expect(model).not.toBeNull();
          expect(JSON.stringify(model)).not.toContain("pace-config-only-secret");

          const ctx: piAi.Context = {
            systemPrompt: "test",
            messages: [{ role: "user", content: "hi", timestamp: Date.now() }],
          };
          expect(await safeComplete(model!, ctx)).toBe("ok");
          const options = completeSpy.mock.calls[0][2] as piAi.StreamOptions;
          expect(options.apiKey).toBe("pace-config-only-secret");
        });
      } finally {
        completeSpy.mockRestore();
      }
    });
  });

  describe("null model", () => {
    test("summarizeItem skips complete", async () => {
      const completeSpy = spyOn(piAi, "complete");
      const item = makeItem({ title: "Null Model Test" });
      const res = await summarizeItem(null, item);
      expect(res).toBe(null);
      expect(completeSpy).not.toHaveBeenCalled();
      completeSpy.mockRestore();
    });

    test("mergeItems skips complete", async () => {
      const completeSpy = spyOn(piAi, "complete");
      const items = [makeItem({ id: "n1" }), makeItem({ id: "n2" })];
      const res = await mergeItems(null, items);
      expect(res).toEqual(items);
      expect(completeSpy).not.toHaveBeenCalled();
      completeSpy.mockRestore();
    });

    test("filterItemsByLlm skips complete", async () => {
      const completeSpy = spyOn(piAi, "complete");
      const items = [makeItem({ id: "f1" })];
      const res = await filterItemsByLlm(null, items, "keep all");
      expect(res).toEqual(items);
      expect(completeSpy).not.toHaveBeenCalled();
      completeSpy.mockRestore();
    });

    test("lensItems skips complete", async () => {
      const completeSpy = spyOn(piAi, "complete");
      const items = [makeItem({ id: "l1" })];
      const res = await lensItems(null, items, ["interest"]);
      expect(res).toEqual(items);
      expect(completeSpy).not.toHaveBeenCalled();
      completeSpy.mockRestore();
    });

    test("summarizeItems skips complete", async () => {
      const completeSpy = spyOn(piAi, "complete");
      const items = [makeItem({ id: "s1" })];
      const res = await summarizeItems(null, items);
      expect(res).toEqual(items);
      expect(completeSpy).not.toHaveBeenCalled();
      completeSpy.mockRestore();
    });
  });
});
