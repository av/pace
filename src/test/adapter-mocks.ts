import { afterEach, beforeEach, mock, spyOn } from "bun:test";
import type { AdapterConfig } from "../adapters/types";

const originalFetch = globalThis.fetch;

export type FetchMockSuite = {
  readonly fetchMock: ReturnType<typeof mock>;
  readonly warnSpy: ReturnType<typeof spyOn>;
};

/** Install fetch + console.warn mocks for adapter tests. Call once per describe(). */
export function useFetchMockSuite(): FetchMockSuite {
  let fetchMock!: ReturnType<typeof mock>;
  let warnSpy!: ReturnType<typeof spyOn>;

  beforeEach(() => {
    fetchMock = mock();
    globalThis.fetch = fetchMock as typeof fetch;
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    warnSpy.mockRestore();
    // Do not call mock.restore() here — it clears mock.module() from other files
    // (e.g. discoverAdapters fs mocks) and races with per-test errorMessage spies.
  });

  return {
    get fetchMock() {
      return fetchMock;
    },
    get warnSpy() {
      return warnSpy;
    },
  };
}

export function adapterCfg(type: string, params: Record<string, unknown> = {}): AdapterConfig {
  return { type, params };
}