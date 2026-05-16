import type { Adapter, AdapterConfig, ContentItem } from "./types";

const adapter: Adapter = {
  name: "twitter",
  async fetch(config: AdapterConfig): Promise<ContentItem[]> {
    const lists = config.params?.lists as string[] | undefined;
    const searches = config.params?.searches as string[] | undefined;

    const terms = lists ?? searches ?? [];
    if (terms.length > 0) {
      console.log(
        `twitter: adapter configured with ${terms.length} source(s), but Twitter API requires API credentials. ` +
          "Set params.bearer_token to enable. Returning empty results.",
      );
    } else {
      console.log(
        "twitter: no lists or searches configured, and Twitter API requires credentials. Returning empty results.",
      );
    }

    return [];
  },
};

export default adapter;
