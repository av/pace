import { join } from "node:path";
import { expect, mock, spyOn } from "bun:test";
import type { AdapterConfig, ContentItem } from "../adapters/types";
import { spyMockCallsContaining } from "./console-spy";

const ADAPTERS_DIR = join(import.meta.dir, "../adapters");

export const DISCOVERY_FILTER_NOISE = ["foo.test.ts", "types.ts", "index.ts", "bar.js"] as const;

export const emptyAdapterFetch = async (_config: AdapterConfig): Promise<ContentItem[]> => [];

function adapterModulePath(file: string): string {
  return join(ADAPTERS_DIR, file);
}

export function mockAdapterModule(file: string, exports: Record<string, unknown>): void {
  mock.module(adapterModulePath(file), () => exports);
}

export function mockReaddir(entries: unknown): void {
  mock.module("node:fs/promises", () => ({
    readdir: async () => entries,
  }));
}

export function mockReaddirThrows(err: Error): void {
  mock.module("node:fs/promises", () => ({
    readdir: async () => {
      throw err;
    },
  }));
}

export function readdirWithRss(...entries: unknown[]): unknown[] {
  return ["rss.ts", ...entries, ...DISCOVERY_FILTER_NOISE];
}

export function readdirOnly(...entries: unknown[]): unknown[] {
  return [...entries, ...DISCOVERY_FILTER_NOISE];
}

export function mockAdapterDefault(file: string, adapter: Record<string, unknown>): void {
  mockAdapterModule(file, { default: adapter });
}

export function discoveryWarnsContaining(
  spy: ReturnType<typeof spyOn>,
  fragment: string,
): string[] {
  return spyMockCallsContaining(spy, fragment).map((call) => String(call[0]));
}

export function expectNoImportOrBadModWarnings(warnSpy: ReturnType<typeof spyOn>): void {
  expect(discoveryWarnsContaining(warnSpy, "failed to import")).toHaveLength(0);
  expect(discoveryWarnsContaining(warnSpy, "invalid default export")).toHaveLength(0);
}

function expectAdaptersRegistered(adapters: Map<string, unknown>, names: string[]): void {
  for (const name of names) {
    expect(adapters.has(name)).toBe(true);
  }
}

export function expectInvalidDefaultExport(
  adapters: Map<string, unknown>,
  warnSpy: ReturnType<typeof spyOn>,
  file: string,
  rejectedNames: string[],
  acceptedNames: string[] = [],
): void {
  expectAdaptersRegistered(adapters, acceptedNames);
  for (const name of rejectedNames) {
    expect(adapters.has(name)).toBe(false);
  }
  expect(discoveryWarnsContaining(warnSpy, "failed to import").length).toBe(0);
  const badModWarns = discoveryWarnsContaining(warnSpy, "invalid default export");
  expect(badModWarns.length).toBe(1);
  expect(badModWarns[0] ?? "").toContain(file);
}

export function expectSkippedWithoutWarnings(
  adapters: Map<string, unknown>,
  warnSpy: ReturnType<typeof spyOn>,
  rejectedNames: string[],
  acceptedNames: string[] = [],
): void {
  expectAdaptersRegistered(adapters, acceptedNames);
  for (const name of rejectedNames) {
    expect(adapters.has(name)).toBe(false);
  }
  expectNoImportOrBadModWarnings(warnSpy);
}