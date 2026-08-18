import { errorMessage } from "./utils";

const NOTIFY_PREFIX = "notify";

/** Prefix a message with notify module name and log as info. */
export function logNotify(message: string): void {
  console.log(`${NOTIFY_PREFIX}: ${message}`);
}

/** Prefix a message with notify module name and log as warning. */
export function warnNotify(message: string): void {
  console.warn(`${NOTIFY_PREFIX}: ${message}`);
}

/**
 * Warn when a webhook delivery fails; the caller leaves the items unmarked so
 * they are retried on the next refresh.
 */
export function warnNotifyDeliveryFailure(ruleLabel: string, err: unknown): void {
  warnNotify(`failed to deliver webhook for rule "${ruleLabel}": ${errorMessage(err)}`);
}
