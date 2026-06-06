import { spyOn } from "bun:test";

export type ConsoleSpyMethod = "log" | "warn";
export type Spy = ReturnType<typeof spyOn>;

/** Spy console methods for one test; restores in finally (safe across async). */
export async function spyConsole<T>(
  methods: ConsoleSpyMethod[],
  fn: (spies: Record<ConsoleSpyMethod, ReturnType<typeof spyOn>>) => T | Promise<T>
): Promise<T> {
  const spies = Object.fromEntries(
    methods.map((m) => [m, spyOn(console, m)])
  ) as Record<ConsoleSpyMethod, ReturnType<typeof spyOn>>;
  try {
    return await fn(spies);
  } finally {
    for (const m of methods) {
      spies[m].mockRestore();
    }
  }
}

/** First argument of the nth spy invocation as string. */
export function spyMockCallText(spy: Spy, index = 0): string {
  return String(spy.mock.calls[index]?.[0]);
}

/** Spy invocations whose first string argument matches predicate. */
export function spyMockCallsMatching(
  spy: Spy,
  predicate: (text: string) => boolean,
): unknown[][] {
  return spy.mock.calls.filter((call) => predicate(String(call[0])));
}

export function spyMockCallsContaining(spy: Spy, substring: string): unknown[][] {
  return spyMockCallsMatching(spy, (text) => text.includes(substring));
}

export function spyMockCallsStartingWith(spy: Spy, prefix: string): unknown[][] {
  return spyMockCallsMatching(spy, (text) => text.startsWith(prefix));
}