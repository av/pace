import {
  CLUSTER_STRATEGIES,
  DECAY_TYPES,
  DEDUPE_DEFAULT_STRATEGY,
  DEDUPE_KEEP_OPTIONS,
  DEDUPE_STRATEGIES,
  isRecord,
  KEYWORD_FIELDS,
  KEYWORD_SCORE_ENTRY_FIELDS,
  SORT_DIRECTIONS,
  SORT_FIELDS,
  TRANSFORM_TYPES,
  transformAllowedFieldKeys,
  type DedupeStrategy,
  type TransformConfig,
  type TransformType,
} from "./config/types";
import {
  validateAllowedKeys,
  validateEnum,
  validateFiniteNumber,
  validateNonEmptyArray,
  validateNonEmptyString,
  validateOptionalBoolean,
  validateOptionalEnum,
  validateOptionalFiniteNumber,
  validateOptionalNonEmptyString,
  validateOptionalPositiveInteger,
  validateOptionalStringList,
  validateOptionalUnitNumber,
  validatePositiveInteger,
  validateStringList,
} from "./validate-primitives";

export type TransformFieldValidator = (transform: Record<string, unknown>, path: string) => void;

export interface TransformSchema {
  fields: readonly string[];
  validate?: TransformFieldValidator;
}

function resolveDedupeStrategyForValidation(strategy: unknown): DedupeStrategy {
  return strategy === undefined ? DEDUPE_DEFAULT_STRATEGY : (strategy as DedupeStrategy);
}

function validateDedupeStrategyFields(transform: Record<string, unknown>, path: string): void {
  const strategy = resolveDedupeStrategyForValidation(transform.strategy);

  if (transform.threshold !== undefined && strategy !== "title-similarity") {
    throw new Error(
      `config: ${path}.threshold is only valid for dedupe strategy "title-similarity" (got "${strategy}")`,
    );
  }
  if (
    transform.keep !== undefined &&
    strategy !== "domain-normalized" &&
    strategy !== "title-similarity"
  ) {
    throw new Error(
      `config: ${path}.keep is only valid for dedupe strategies "domain-normalized" and "title-similarity" (got "${strategy}")`,
    );
  }
}

function validateKeywordScoreEntries(value: unknown, path: string): void {
  validateNonEmptyArray(value, path);

  value.forEach((entry, index) => {
    const entryPath = `${path}[${index}]`;
    if (!isRecord(entry)) {
      throw new Error(`config: ${entryPath} must be an object`);
    }
    validateAllowedKeys(entry, KEYWORD_SCORE_ENTRY_FIELDS, (key) =>
      `${entryPath}.${key} is not a valid keyword-score entry field`,
    );
    validateNonEmptyString(entry.term, `${entryPath}.term`);
    validateFiniteNumber(entry.weight, `${entryPath}.weight`);
    validateOptionalBoolean(entry.regex, `${entryPath}.regex`);
  });
}

function validateFilterExcludeFields(transform: Record<string, unknown>, path: string): void {
  validateStringList(transform.keywords, `${path}.keywords`);
  if (transform.fields !== undefined) {
    validateNonEmptyArray(transform.fields, `${path}.fields`);
    transform.fields.forEach((field, fieldIndex) =>
      validateEnum(field, KEYWORD_FIELDS, `${path}.fields[${fieldIndex}]`),
    );
  }
}

/** Per-type field validators; explicit entry for every TransformType (undefined = allowed-keys only). */
export const TRANSFORM_VALIDATORS = {
  latest: (transform, path) => validatePositiveInteger(transform.count, `${path}.count`),
  filter: validateFilterExcludeFields,
  exclude: validateFilterExcludeFields,
  sort: (transform, path) => {
    validateEnum(transform.field, SORT_FIELDS, `${path}.field`);
    validateOptionalEnum(transform.direction, SORT_DIRECTIONS, `${path}.direction`);
  },
  dedupe: (transform, path) => {
    validateOptionalEnum(transform.strategy, DEDUPE_STRATEGIES, `${path}.strategy`);
    validateOptionalUnitNumber(transform.threshold, `${path}.threshold`);
    validateOptionalEnum(transform.keep, DEDUPE_KEEP_OPTIONS, `${path}.keep`);
    validateOptionalBoolean(transform.log, `${path}.log`);
    validateDedupeStrategyFields(transform, path);
  },
  "keyword-score": (transform, path) => {
    validateKeywordScoreEntries(transform.keywords, `${path}.keywords`);
    validateOptionalFiniteNumber(transform.min_score, `${path}.min_score`);
    validateOptionalBoolean(transform.annotate, `${path}.annotate`);
  },
  "time-decay": (transform, path) => {
    validateOptionalNonEmptyString(transform.half_life, `${path}.half_life`);
    validateOptionalFiniteNumber(transform.engagement_weight, `${path}.engagement_weight`);
    validateOptionalFiniteNumber(transform.recency_weight, `${path}.recency_weight`);
    validateOptionalEnum(transform.decay, DECAY_TYPES, `${path}.decay`);
    validateOptionalBoolean(transform.annotate, `${path}.annotate`);
    validateOptionalFiniteNumber(transform.min_score, `${path}.min_score`);
  },
  cluster: (transform, path) => {
    validateOptionalEnum(transform.strategy, CLUSTER_STRATEGIES, `${path}.strategy`);
    validateOptionalPositiveInteger(transform.min_cluster_size, `${path}.min_cluster_size`);
    validateOptionalPositiveInteger(transform.max_clusters, `${path}.max_clusters`);
    validateOptionalUnitNumber(transform.similarity_threshold, `${path}.similarity_threshold`);
    validateOptionalBoolean(transform.annotate, `${path}.annotate`);
  },
  "llm-summarize": (transform, path) => validateOptionalBoolean(transform.fetch_content, `${path}.fetch_content`),
  "llm-filter": (transform, path) => {
    validateOptionalNonEmptyString(transform.criteria, `${path}.criteria`);
    if (transform.criteria === undefined) {
      throw new Error(`config: ${path}.criteria is required`);
    }
  },
  "llm-rank": (transform, path) => validateOptionalStringList(transform.interests, `${path}.interests`),
  "llm-merge": (transform, path) => validateOptionalNonEmptyString(transform.prompt, `${path}.prompt`),
} satisfies Readonly<Record<TransformType, TransformFieldValidator | undefined>>;

/** Canonical validation schemas derived from TRANSFORM_TYPES + TRANSFORM_VALIDATORS. */
export const TRANSFORM_SCHEMAS: Readonly<Record<TransformType, TransformSchema>> = Object.fromEntries(
  TRANSFORM_TYPES.map((transformType) => [
    transformType,
    {
      fields: transformAllowedFieldKeys(transformType),
      validate: TRANSFORM_VALIDATORS[transformType],
    },
  ]),
) as Readonly<Record<TransformType, TransformSchema>>;

export function isTransformType(value: string): value is TransformType {
  return value in TRANSFORM_SCHEMAS;
}

function validateTransform(transform: Record<string, unknown>, path: string): void {
  const transformType = transform.type;
  if (typeof transformType !== "string" || !isTransformType(transformType)) {
    throw new Error(`config: ${path}.type references unknown transform "${transformType}"`);
  }
  const schema = TRANSFORM_SCHEMAS[transformType];
  validateAllowedKeys(transform, schema.fields, (key) =>
    `${path}.${key} is not a valid ${transformType} transform field`,
  );
  schema.validate?.(transform, path);
}

export function validateTransforms(transforms: unknown, path: string): asserts transforms is TransformConfig[] {
  if (!Array.isArray(transforms)) {
    throw new Error(`config: ${path} must be a list`);
  }

  transforms.forEach((transform, index) => {
    if (!isRecord(transform)) {
      throw new Error(`config: ${path}[${index}] must be an object`);
    }
    validateNonEmptyString(transform.type, `${path}[${index}].type`);
    validateTransform(transform, `${path}[${index}]`);
  });
}