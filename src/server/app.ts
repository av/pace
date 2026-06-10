import { Hono } from "hono";
import { securityHeadersMiddleware } from "./security-headers";
import { BUNDLED_STATIC, registerBundledStatic } from "./static";
import { registerServerRoutes, type ServerRouteDeps } from "./routes";

export type CreateServerAppOptions = {
  /** Override bundled asset source directory (tests). */
  srcDir?: string;
};

/** Create the Hono app with middleware, static assets, and dashboard routes. */
export function createServerApp(
  deps: ServerRouteDeps,
  options: CreateServerAppOptions = {},
): Hono {
  const app = new Hono();
  app.use("*", securityHeadersMiddleware());
  registerBundledStatic(app, BUNDLED_STATIC, options.srcDir);
  registerServerRoutes(app, deps);
  return app;
}