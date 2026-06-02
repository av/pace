import { type Adapter, type AdapterConfig, type ContentItem } from "./types";

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
