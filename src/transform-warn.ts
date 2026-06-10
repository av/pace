import { errorMessage } from "./utils";

const TRANSFORM_PREFIX = "transforms";

/** Prefix a message with transforms module name and log as info. */
export function logTransform(message: string): void {
  console.log(`${TRANSFORM_PREFIX}: ${message}`);
}

/** Log indented detail lines for transform operational output (dedupe removed items, etc.). */
export function logTransformDetail(message: string): void {
  console.log(`  ${message}`);
}

/** Format one dedupe-removed item line for transform operational logs. */
export function formatTransformDedupeRemovedLine(
  loser: { title: string; url: string | null },
  winner?: { title: string },
): string {
  const line = `"${loser.title}" (${loser.url})`;
  return winner ? `${line} -> kept "${winner.title}"` : line;
}

/** Log dedupe removal summary with capped detail lines. */
export function logTransformDedupeRemoved(
  label: string,
  removed: string[],
  extra = "",
): void {
  logTransform(`dedupe:${label} removed ${removed.length} duplicate(s)${extra}:`);
  for (const r of removed.slice(0, 10)) logTransformDetail(`- ${r}`);
  if (removed.length > 10) logTransformDetail(`... and ${removed.length - 10} more`);
}

/** Log when min_score filter removes items from a scored transform. */
export function logTransformMinScoreFiltered(
  label: string,
  removedCount: number,
  minScore: number,
): void {
  logTransform(`${label} filtered out ${removedCount} item(s) below min_score=${minScore}`);
}

/** Prefix a message with transforms module name and log as warning. */
export function warnTransform(message: string): void {
  console.warn(`${TRANSFORM_PREFIX}: ${message}`);
}

/** Warn when time-decay half_life fails to parse; caller applies fallback. */
export function warnInvalidHalfLife(value: string, fallback: string): void {
  warnTransform(`invalid half_life "${value}", defaulting to ${fallback}`);
}

/** Warn when keyword-score regex is invalid; caller treats term as literal. */
export function warnInvalidKeywordScoreRegex(term: string, err: unknown): void {
  warnTransform(
    `invalid keyword-score regex "${term}": ${errorMessage(err)}, treating as literal`,
  );
}

/** Warn when pipeline references an unknown transform type. */
export function warnUnknownTransformType(type: string): void {
  warnTransform(`unknown transform type "${type}", skipping`);
}

/** Warn when dedupe strategy is unrecognized; caller passes items through. */
export function warnUnknownDedupeStrategy(strategy: string): void {
  warnTransform(`unknown dedupe strategy "${strategy}", passing items through`);
}

/** Log cluster transform summary after grouping completes. */
export function logTransformClusterSummary(
  strategy: string,
  clusters: ReadonlyArray<{ label: string; indices: readonly unknown[] }>,
  unclusteredCount: number,
): void {
  const clusterSummary = clusters
    .map((c) => `"${c.label}" (${c.indices.length} items)`)
    .join(", ");
  logTransform(
    `cluster strategy=${strategy}, ${clusters.length} cluster(s): ${clusterSummary || "none"}, ${unclusteredCount} unclustered`,
  );
}