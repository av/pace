import { errorMessage } from "./utils";

const SCHEDULER_PREFIX = "scheduler";

/** Prefix a message with scheduler module name and log as warning. */
export function warnScheduler(message: string): void {
  console.warn(`${SCHEDULER_PREFIX}: ${message}`);
}

/** Warn when adapter or pipeline refresh fails; caller records error on entry. */
export function warnRefreshFailure(name: string, err: unknown): void {
  warnScheduler(`failed to refresh ${name}: ${errorMessage(err)}`);
}

/** Warn when periodic prune fails; caller continues without rethrow. */
export function warnPruneFailure(err: unknown): void {
  warnScheduler(`failed to prune: ${errorMessage(err)}`);
}