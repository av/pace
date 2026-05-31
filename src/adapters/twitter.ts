import { type Adapter, type AdapterConfig, type ContentItem, errorMessage } from "./types";

function logAndReturnEmpty(msg: string): ContentItem[] {
  console.log(errorMessage({ message: msg }));
  return [];
}

const adapter: Adapter = {
  name: "twitter",
  async fetch(config: AdapterConfig): Promise<ContentItem[]> {
    const lists = config.params?.lists as string[] | undefined;
    const searches = config.params?.searches as string[] | undefined;

    const terms = lists ?? searches ?? [];
    if (terms.length > 0) {
      return logAndReturnEmpty(
        `twitter: adapter configured with ${terms.length} source(s), but Twitter API requires API credentials. ` +
          "Set params.bearer_token to enable. Returning empty results.",
      );
    } else {
      return logAndReturnEmpty(
        "twitter: no lists or searches configured, and Twitter API requires credentials. Returning empty results.",
      );
    }
  },
};

export default adapter;
