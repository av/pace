import { errorMessage } from "./utils";

export const DEFAULT_GIST_RENDERER = "https://gisthost.github.io/";
export const DEFAULT_GIST_FILENAME = "index.html";

export interface StaticDashboardArtifact {
  html: string;
  css: string;
}

export interface GistPublishOptions {
  token?: string;
  gistId?: string;
  public?: boolean;
  renderer?: string;
  description?: string;
  fetchImpl?: (url: string | URL | Request, init?: RequestInit) => Promise<Response>;
}

export interface GistPublishResult {
  backend: "gist";
  gistId: string;
  gistUrl: string;
  shareUrl: string;
}

interface GitHubGistResponse {
  id?: unknown;
  html_url?: unknown;
}

function normalizeRenderer(renderer = DEFAULT_GIST_RENDERER): string {
  const trimmed = renderer.trim();
  if (!trimmed) return DEFAULT_GIST_RENDERER;
  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}

export function renderGistShareUrl(gistId: string, renderer = DEFAULT_GIST_RENDERER): string {
  return `${normalizeRenderer(renderer)}?${encodeURIComponent(gistId)}`;
}

function gistToken(explicit?: string): string {
  const token = explicit ?? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (!token) {
    throw new Error("share: GitHub token required (set GITHUB_TOKEN or GH_TOKEN)");
  }
  return token;
}

function gistRequestBody(
  artifact: StaticDashboardArtifact,
  options: Pick<GistPublishOptions, "public" | "description">,
): string {
  return JSON.stringify({
    description: options.description ?? "pace static dashboard",
    public: options.public ?? false,
    files: {
      [DEFAULT_GIST_FILENAME]: { content: artifact.html },
      "styles.css": { content: artifact.css },
    },
  });
}

function gistEndpoint(gistId?: string): { method: "POST" | "PATCH"; url: string } {
  if (gistId) {
    return { method: "PATCH", url: `https://api.github.com/gists/${encodeURIComponent(gistId)}` };
  }
  return { method: "POST", url: "https://api.github.com/gists" };
}

function parseGistResponse(payload: GitHubGistResponse, fallbackId?: string): { id: string; url: string } {
  const id = typeof payload.id === "string" && payload.id ? payload.id : fallbackId;
  if (!id) throw new Error("share: GitHub Gist response did not include an id");
  const url = typeof payload.html_url === "string" && payload.html_url
    ? payload.html_url
    : `https://gist.github.com/${id}`;
  return { id, url };
}

export async function publishGistArtifact(
  artifact: StaticDashboardArtifact,
  options: GistPublishOptions = {},
): Promise<GistPublishResult> {
  const token = gistToken(options.token);
  const request = gistEndpoint(options.gistId);
  const fetchImpl = options.fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await fetchImpl(request.url, {
      method: request.method,
      headers: {
        "Accept": "application/vnd.github+json",
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "pace",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: gistRequestBody(artifact, options),
    });
  } catch (err) {
    throw new Error(`share: failed to publish GitHub Gist: ${errorMessage(err)}`);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    const suffix = detail ? `: ${detail.slice(0, 300)}` : "";
    throw new Error(`share: GitHub Gist publish failed with ${response.status}${suffix}`);
  }

  let payload: GitHubGistResponse;
  try {
    payload = await response.json() as GitHubGistResponse;
  } catch (err) {
    throw new Error(`share: failed to parse GitHub Gist response: ${errorMessage(err)}`);
  }

  const parsed = parseGistResponse(payload, options.gistId);
  return {
    backend: "gist",
    gistId: parsed.id,
    gistUrl: parsed.url,
    shareUrl: renderGistShareUrl(parsed.id, options.renderer),
  };
}

export function formatGistPublishResult(result: GistPublishResult): string {
  return `backend: ${result.backend}\ngist: ${result.gistUrl}\nurl: ${result.shareUrl}`;
}
