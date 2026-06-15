/** Shared config field validators used by config-validate and transform-validate. */

export function validateAllowedKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  message: (key: string) => string,
): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(record)) {
    if (!allowedSet.has(key)) {
      throw new Error(`config: ${message(key)}`);
    }
  }
}

export function validateNonEmptyString(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`config: ${path} must be a non-empty string`);
  }
}

export function validateNonEmptyArray(value: unknown, path: string): asserts value is unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`config: ${path} must be a list`);
  }
  if (value.length === 0) {
    throw new Error(`config: ${path} must not be empty`);
  }
}

export function validatePositiveNumber(value: unknown, path: string): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`config: ${path} must be a positive number`);
  }
}

export function validatePositiveInteger(value: unknown, path: string): void {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`config: ${path} must be a positive integer`);
  }
}

export function validateNonNegativeNumber(value: unknown, path: string): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`config: ${path} must be a non-negative number`);
  }
}

export function validateFiniteNumber(value: unknown, path: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`config: ${path} must be a number`);
  }
}

function validateOptional(value: unknown, path: string, validator: (v: unknown, p: string) => void): void {
  if (value !== undefined) {
    validator(value, path);
  }
}

function optionalValidator(validator: (v: unknown, p: string) => void): (value: unknown, path: string) => void {
  return (value, path) => validateOptional(value, path, validator);
}

function validateBoolean(value: unknown, path: string): void {
  if (typeof value !== "boolean") {
    throw new Error(`config: ${path} must be a boolean`);
  }
}

function validateList(value: unknown, path: string): void {
  if (!Array.isArray(value)) {
    throw new Error(`config: ${path} must be a list`);
  }
}

function validateUnitNumber(value: unknown, path: string): void {
  validateFiniteNumber(value, path);
  if (value < 0 || value > 1) {
    throw new Error(`config: ${path} must be between 0 and 1`);
  }
}

export const validateOptionalPositiveNumber = optionalValidator(validatePositiveNumber);
export const validateOptionalNonNegativeNumber = optionalValidator(validateNonNegativeNumber);
export const validateOptionalPositiveInteger = optionalValidator(validatePositiveInteger);
export const validateOptionalFiniteNumber = optionalValidator(validateFiniteNumber);
export const validateOptionalBoolean = optionalValidator(validateBoolean);
export const validateOptionalNonEmptyString = optionalValidator(validateNonEmptyString);
export const validateOptionalList = optionalValidator(validateList);
export const validateOptionalUnitNumber = optionalValidator(validateUnitNumber);

export function validateStringList(value: unknown, path: string): asserts value is string[] {
  validateNonEmptyArray(value, path);
  value.forEach((entry, index) => {
    validateNonEmptyString(entry, `${path}[${index}]`);
  });
}

export function validateUniqueStrings(
  entries: readonly string[],
  path: string,
  duplicateLabel: string,
  options?: { formatDuplicateError?: (entry: string, index: number) => string },
): void {
  const seen = new Set<string>();
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]!;
    if (seen.has(entry)) {
      const message = options?.formatDuplicateError?.(entry, index)
        ?? `config: ${path}[${index}] duplicates ${duplicateLabel} "${entry}"`;
      throw new Error(message);
    }
    seen.add(entry);
  }
}

export function validateUniqueStringList(
  value: unknown,
  path: string,
  allowed?: Set<string>,
  duplicateLabel = "source",
): asserts value is string[] {
  validateStringList(value, path);
  validateUniqueStrings(value, path, duplicateLabel);
  if (allowed) {
    for (let index = 0; index < value.length; index++) {
      const entry = value[index];
      const entryPath = `${path}[${index}]`;
      if (!allowed.has(entry)) {
        throw new Error(`config: ${entryPath} references unknown source "${entry}"`);
      }
    }
  }
}

export const validateOptionalStringList = optionalValidator(validateStringList);

export function validateEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
): void {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new Error(`config: ${path} must be one of: ${allowed.join(", ")}`);
  }
}

export function validateOptionalEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
): void {
  validateOptional(value, path, (v, p) => validateEnum(v, allowed, p));
}