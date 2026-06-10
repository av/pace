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

/** Build 404 response body for an unknown refresh panel param. */
export function formatUnknownRefreshPanelBody(param: string): string {
  return `Unknown panel: ${param}`;
}