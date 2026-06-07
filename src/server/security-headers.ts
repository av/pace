import type { MiddlewareHandler } from "hono";

/** Apply standard security headers to every response. */
export function securityHeadersMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    c.header("X-Frame-Options", "DENY");
    c.header("Referrer-Policy", "strict-origin-when-cross-origin");
    c.header("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'");
    c.header("Permissions-Policy", "interest-cohort=()");
  };
}