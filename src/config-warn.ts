const CONFIG_PREFIX = "config";

/** Prefix a message with config module name and log as warning. */
export function warnConfig(message: string): void {
  console.warn(`${CONFIG_PREFIX}: ${message}`);
}

/** Warn once per env var name when unset; caller expands to empty. */
export function warnUnsetEnvVar(name: string, warnedUnset: Set<string>): void {
  if (warnedUnset.has(name)) return;
  warnedUnset.add(name);
  warnConfig(`env var ${name} is unset (expanding to empty)`);
}