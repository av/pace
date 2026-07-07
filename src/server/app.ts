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

  const routes = new Hono();
  registerBundledStatic(routes, BUNDLED_STATIC, options.srcDir);
  registerServerRoutes(routes, deps);

  app.route("/", routes);
  // Also serve everything under the configured base path so deployments work
  // whether or not the reverse proxy strips the prefix before forwarding.
  if (deps.basePath) app.route(deps.basePath, routes);

  return app;
}