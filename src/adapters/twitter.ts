import { normalizeParamStringList } from "../utils";
import { type Adapter, type AdapterConfig, type ContentItem } from "./types";

function warnAndReturnEmpty(msg: string): ContentItem[] {
  console.warn(msg.startsWith("twitter:") ? msg : `twitter: ${msg}`);
  return [];
}

const adapter: Adapter = {
  name: "twitter",
  async fetch(config: AdapterConfig): Promise<ContentItem[]> {
    const lists = normalizeParamStringList(config.params, "lists");
    const searches = normalizeParamStringList(config.params, "searches");

    const terms = lists.length > 0 ? lists : searches;
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
