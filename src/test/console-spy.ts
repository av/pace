import { spyOn } from "bun:test";

export type ConsoleSpyMethod = "log" | "warn";

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