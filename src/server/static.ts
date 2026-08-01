import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Hono } from "hono";
import { errorMessage } from "../utils";

export type BundledStatic = {
  route: `/${string}`;
  file: string;
  contentType: string;
};

export const BUNDLED_STATIC: BundledStatic[] = [
  { route: "/styles.css", file: "styles.css", contentType: "text/css" },
  { route: "/dashboard.js", file: "dashboard.js", contentType: "text/javascript" },
];

export function readBundledText(srcDir: string, file: string): string {
  try {
    return readFileSync(join(srcDir, file), "utf-8");
  } catch (err) {
    throw new Error(`index: failed to read ${file}: ${errorMessage(err)}`);
  }
}

export const DEFAULT_SRC_DIR = join(import.meta.dir, "..");

export function registerBundledStatic(
  app: Hono,
  assets: BundledStatic[],
  srcDir: string = DEFAULT_SRC_DIR,
): void {
  for (const { route, file, contentType } of assets) {
    const body = readBundledText(srcDir, file);
    app.get(route, (c) =>
      c.body(body, 200, {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600",
      }),
    );
  }
}
