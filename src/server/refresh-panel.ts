import type { RefreshResult } from "../scheduler";

export type RefreshPanelBinding =
  | { ok: true; panelId: string; sourceNames: string[] }
  | { ok: false; param: string };

/** Resolve refresh route param to panel id and precomputed source names. */
export function resolveRefreshPanelBinding(
  param: string,
  panelNameToId: Map<string, string>,
  panelIdToRefreshSourceNames: Map<string, string[]>,
): RefreshPanelBinding {
  const panelId = panelNameToId.get(param) ?? param;
  const sourceNames = panelIdToRefreshSourceNames.get(panelId);
  if (!sourceNames) return { ok: false, param };
  return { ok: true, panelId, sourceNames };
}

/** Format one failed refresh source for HTTP error bodies. */
export function formatRefreshSourceFailure(name: string, error?: string): string {
  return error ? `${name}: ${error}` : name;
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

/** Build 404 response body for an unknown refresh panel param. */
export function formatUnknownRefreshPanelBody(param: string): string {
  return `Unknown panel: ${param}`;
}