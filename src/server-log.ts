const SERVER_PREFIX = "index";

/** Log when the HTTP server starts listening (index.ts startup). */
export function logServerListening(port: number): void {
  console.log(`${SERVER_PREFIX}: listening on http://localhost:${port}`);
}