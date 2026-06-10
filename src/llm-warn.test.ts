import { describe, test, expect, spyOn, afterEach } from "bun:test";
import { warnLlm } from "./llm-warn";

describe("llm warn utilities", () => {
  let warnSpy: ReturnType<typeof spyOn>;

  afterEach(() => {
    warnSpy?.mockRestore();
  });

  test("warnLlm prefixes message-only warnings with llm module name", () => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    warnLlm("unknown provider/model (foo/bar), using OpenAI-compatible fallback");
    expect(warnSpy).toHaveBeenCalledWith(
      "llm: unknown provider/model (foo/bar), using OpenAI-compatible fallback",
    );
  });

  test("warnLlm appends error detail when err is provided", () => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    warnLlm("complete failed", new Error("simulated fail"));
    expect(warnSpy).toHaveBeenCalledWith("llm: complete failed: simulated fail");
  });
});