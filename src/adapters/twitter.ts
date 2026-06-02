import { decodeHtmlEntities } from "./html";
import { type Adapter, type AdapterConfig, type ContentItem } from "./types";

/** Twitter API v2 `text` → item title (parity with other adapters). */
export function decodeTweetTitle(text?: string): string {
  if (!text) return "(untitled)";
  return decodeHtmlEntities(text, { numeric: true });
}

function buildTweetItem(
  id: string,
  text: string | undefined,
  url: string,
  source: string,
  timestamp: Date,
): ContentItem {
  return {
    id,
    title: decodeTweetTitle(text),
    url,
    source,
    timestamp,
  };
}

function warnAndReturnEmpty(msg: string): ContentItem[] {
  console.warn(msg.startsWith("twitter:") ? msg : `twitter: ${msg}`);
  return [];
}

const adapter: Adapter = {
  name: "twitter",
  async fetch(config: AdapterConfig): Promise<ContentItem[]> {
    const lists = config.params?.lists as string[] | undefined;
    const searches = config.params?.searches as string[] | undefined;

    const terms = lists ?? searches ?? [];
    if (terms.length > 0) {
      return warnAndReturnEmpty(
        `adapter configured with ${terms.length} source(s); Twitter API requires params.bearer_token. Returning empty results.`,
      );
    }
    return warnAndReturnEmpty(
      "no lists or searches configured; Twitter API requires params.bearer_token. Returning empty results.",
    );
  },
};

export default adapter;
