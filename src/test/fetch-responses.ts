/** Build a failed fetch Response for adapter error-path tests. */
export function makeErrorResponse(status: number): Response {
  return new Response("", { status });
}

/** Build a text/html Response (e.g. GitHub trending pages, Atom as HTML). */
export function makeTextResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

/** Build an application/json Response for API fixture payloads. */
export function makeJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Build an application/xml Response for RSS/Atom feed fixtures. */
export function makeXmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
}