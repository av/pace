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
  if (deps.basePath) {
    app.route(deps.basePath, routes);
    // `app.route("/pace", routes)` matches "/pace" but NOT "/pace/", while
    // both the refresh redirect (`${basePath}/?failed=...`) and typical
    // reverse-proxy configs produce the trailing-slash form. Canonicalize it
    // to the prefix root, preserving the query string (banner params) and,
    // via 308, the request method.
    app.all(`${deps.basePath}/`, (c) => {
      const url = new URL(c.req.url);
      return c.redirect(deps.basePath + url.search, 308);
    });
  }

  return app;
}