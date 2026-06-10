import { errorMessage } from "./utils";

const DB_PREFIX = "db";

/** Prefix a message with db module name and log as warning. */
export function warnDb(message: string): void {
  console.warn(`${DB_PREFIX}: ${message}`);
}

/** Warn when db.close() fails; caller swallows to preserve shutdown/switch behavior. */
export function warnDbClose(err: unknown): void {
  warnDb(`failed to close: ${errorMessage(err)}`);
}