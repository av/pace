import { normalizeParamStringList } from "../utils";
import { warnEmptyConfig } from "./empty-config";
import { type Adapter, type AdapterConfig, type ContentItem } from "./types";

const adapter: Adapter = {
  name: "twitter",
  async fetch(config: AdapterConfig): Promise<ContentItem[]> {
    const lists = normalizeParamStringList(config.params, "lists");
    const searches = normalizeParamStringList(config.params, "searches");

    const terms = lists.length > 0 ? lists : searches;
    if (terms.length > 0) {
      return warnEmptyConfig(
        "twitter",
        `adapter configured with ${terms.length} source(s); Twitter API requires params.bearer_token. Returning empty results.`,
      );
    }
    return warnEmptyConfig(
      "twitter",
      "no lists or searches configured; Twitter API requires params.bearer_token. Returning empty results.",
    );
  },
};

export default adapter;
