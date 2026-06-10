import type { MiddlewareHandler } from "hono";

/** Canonical security headers applied to every response. */
export const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Content-Security-Policy": "default-src 'self'; style-src 'self' 'unsafe-inline'",
  "Permissions-Policy": "interest-cohort=()",
} as const;

/** Apply standard security headers to every response. */
export function securityHeadersMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    await next();
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      c.header(name, value);
    }
  };
}