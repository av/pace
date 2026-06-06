import { afterEach, beforeEach, mock, spyOn } from "bun:test";
import type { Adapter, AdapterConfig, ContentItem } from "../adapters/types";

const originalFetch = globalThis.fetch;

export type FetchMockSuite = {
  readonly fetchMock: ReturnType<typeof mock>;
  readonly warnSpy: ReturnType<typeof spyOn>;
};

export type FetchMock = FetchMockSuite["fetchMock"];

/** URL from the nth global.fetch mock invocation (default: first). */
export function fetchMockCallUrl(fetchMock: FetchMock, index = 0): string {
  return String(fetchMock.mock.calls[index][0]);
}

/** RequestInit from the nth global.fetch mock invocation, if present. */
export function fetchMockCallInit(fetchMock: FetchMock, index = 0): RequestInit | undefined {
  return fetchMock.mock.calls[index][1] as RequestInit | undefined;
}

/** Headers object from the nth global.fetch mock invocation. */
export function fetchMockCallHeaders(
  fetchMock: FetchMock,
  index = 0,
): Record<string, string> {
  return (fetchMockCallInit(fetchMock, index)?.headers ?? {}) as Record<string, string>;
}

/** All fetch mock invocations as { url, init } pairs. */
export function fetchMockCalls(
  fetchMock: FetchMock,
): Array<{ url: string; init?: RequestInit }> {
  return fetchMock.mock.calls.map((call) => ({
    url: String(call[0]),
    init: call[1] as RequestInit | undefined,
  }));
}

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
    // (e.g. discoverAdapters fs mocks) and races with per-test utils.errorMessage spies.
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

/** Minimal AdapterConfig for adapter tests (not a fetch mock). */
export function adapterCfg(type: string, params: Record<string, unknown> = {}): AdapterConfig {
  return { type, params };
}

/** Stub adapter that returns fixed items (scheduler/integration tests). */
export function makeMockAdapter(items: ContentItem[] = []): Adapter {
  return {
    name: "mock",
    fetch: async () => items,
  };
}

/** Stub adapter whose fetch always throws (scheduler error-path tests). */
export function makeErrorAdapter(msg = "boom"): Adapter {
  return {
    name: "err",
    fetch: async () => {
      throw new Error(msg);
    },
  };
}

/** Build a type→adapter map from [type, adapter] pairs. */
export function adaptersMap(...entries: [string, Adapter][]): Map<string, Adapter> {
  return new Map(entries);
}