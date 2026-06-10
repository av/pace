import { errorMessage } from "./utils";

const TRANSFORM_PREFIX = "transforms";

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