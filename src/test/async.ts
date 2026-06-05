/** Yield to the event loop so fire-and-forget scheduler work can finish in tests. */
export async function waitForAsync(ms = 20): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}