const SERVER_PREFIX = "server";

/** Log when the HTTP server starts listening (bootstrap startup). */
export function logServerListening(port: number): void {
  console.log(`${SERVER_PREFIX}: listening on http://localhost:${port}`);
}