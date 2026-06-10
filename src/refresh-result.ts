import { errorMessage } from "./utils";

export interface RefreshResult {
  kind: "adapter" | "pipeline";
  name: string;
  status: "ok" | "skipped" | "failed";
  error?: string;
}

/** Format one named source with optional error detail (`name: error` or `name`). */
export function formatRefreshSourceFailure(name: string, error?: string): string {
  return error ? `${name}: ${error}` : name;
}

/** Format named source failure from an unknown thrown value. */
export function formatRefreshSourceFailureFromError(name: string, err: unknown): string {
  return formatRefreshSourceFailure(name, errorMessage(err));
}

/** Collect refresh results that reported failure. */
export function collectRefreshFailures(
  results: ReadonlyArray<RefreshResult>,
): RefreshResult[] {
  return results.filter((result) => result.status === "failed");
}

/** Build 502 response body when one or more refresh sources fail. */
export function formatRefreshPanelFailureBody(failures: ReadonlyArray<RefreshResult>): string {
  const details = failures
    .map((result) => formatRefreshSourceFailure(result.name, result.error))
    .join("; ");
  return `Refresh failed for ${details}`;
}