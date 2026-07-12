import { fetchJson, tryOptionalFetch } from "./fetch";
import type { Adapter, AdapterConfig, ContentItem } from "./types";

/**
 * Resolve a dot-notation JSON path with optional bracket array access.
 * Supports: foo.bar.baz, foo[0].bar, data.metrics[2].value
 * Throws on path-not-found.
 */
export function resolveJsonPath(obj: unknown, path: string): unknown {
  const segments = parseJsonPath(path);
  let current: unknown = obj;

  for (const segment of segments) {
    if (current == null || typeof current !== "object") {
      const typeLabel = current === null ? "null" : typeof current;
      throw new Error(`path "${path}" not found: cannot traverse into ${typeLabel}`);
    }

    if (typeof segment === "number") {
      if (!Array.isArray(current)) {
        throw new Error(`path "${path}" not found: expected array at index ${segment}`);
      }
      if (segment < 0 || segment >= current.length) {
        throw new Error(`path "${path}" not found: index ${segment} out of bounds (length ${current.length})`);
      }
      current = current[segment];
    } else {
      const rec = current as Record<string, unknown>;
      if (!Object.hasOwn(rec, segment)) {
        throw new Error(`path "${path}" not found: key "${segment}" does not exist`);
      }
      current = rec[segment];
    }
  }

  return current;
}

/**
 * Parse a JSON path string into segments (string keys and numeric indices).
 * "foo.bar[0].baz" -> ["foo", "bar", 0, "baz"]
 */
export function parseJsonPath(path: string): (string | number)[] {
  const segments: (string | number)[] = [];
  let i = 0;

  while (i < path.length) {
    if (path[i] === ".") {
      i++;
      continue;
    }

    if (path[i] === "[") {
      const close = path.indexOf("]", i);
      if (close === -1) {
        throw new Error(`path "${path}" is malformed: unclosed bracket`);
      }
      const indexStr = path.slice(i + 1, close);
      const index = Number(indexStr);
      if (!Number.isInteger(index) || index < 0) {
        throw new Error(`path "${path}" is malformed: invalid array index "${indexStr}"`);
      }
      segments.push(index);
      i = close + 1;
      continue;
    }

    // Read a key segment until we hit '.', '[', or end
    let end = i;
    while (end < path.length && path[end] !== "." && path[end] !== "[") {
      end++;
    }
    segments.push(path.slice(i, end));
    i = end;
  }

  return segments;
}

/** Interpolate ${ENV_VAR} references in a string. */
export function interpolateEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, varName) => {
    // Bun's process.env exposes Object.prototype members (toString, constructor,
    // ...) as inherited lookups; only accept actual string env values so
    // "${toString}" doesn't inject function source into outgoing headers.
    const resolved = process.env[varName];
    return typeof resolved === "string" ? resolved : "";
  });
}

/** Build headers object with env var interpolation. */
function buildHeaders(rawHeaders: unknown): Record<string, string> | undefined {
  if (rawHeaders == null || typeof rawHeaders !== "object" || Array.isArray(rawHeaders)) {
    return undefined;
  }
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawHeaders as Record<string, unknown>)) {
    if (typeof value === "string") {
      result[key] = interpolateEnvVars(value);
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

const adapter: Adapter = {
  name: "counter",
  async fetch(config: AdapterConfig): Promise<ContentItem[]> {
    const params = config.params ?? {};
    const url = params.url as string;
    const jsonPath = params.json_path as string;
    const adapterName = (config as { name?: string }).name ?? config.type;
    const label = (params.label as string) || adapterName;
    const unit = (params.unit as string) || undefined;
    const compareUrl = params.compare_url as string | undefined;
    const comparePath = (params.compare_path as string) || jsonPath;
    const rawHeaders = params.headers;

    if (!url) {
      throw new Error("counter: url is required");
    }
    if (!jsonPath) {
      throw new Error("counter: json_path is required");
    }

    const headers = buildHeaders(rawHeaders);

    const data = await fetchJson<unknown>("counter", url, url, { headers });
    const value = resolveJsonPath(data, jsonPath);

    let previous: unknown = undefined;
    if (compareUrl) {
      const compareResult = await tryOptionalFetch("counter", "compare_url", async () => {
        const compareData = await fetchJson<unknown>(
          "counter",
          compareUrl,
          `compare_url ${compareUrl}`,
          { headers },
        );
        return resolveJsonPath(compareData, comparePath);
      });
      if (compareResult !== null) {
        previous = compareResult;
      }
    }

    const now = Date.now();
    const bodyObj: Record<string, unknown> = { value };
    if (unit) bodyObj.unit = unit;
    if (previous !== undefined) bodyObj.previous = previous;

    const item: ContentItem = {
      id: `counter:${adapterName}`,
      title: label,
      url: "",
      source: `counter:${adapterName}`,
      timestamp: new Date(now),
      body: JSON.stringify(bodyObj),
    };

    return [item];
  },
};

export default adapter;
