/** RSS feed with empty channel (no items) for contract tests. */
export function rssEmptyChannelFixture(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Empty</title></channel></rss>`;
}