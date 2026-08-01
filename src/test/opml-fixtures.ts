/** OPML fixtures for `pace import` tests. No network use - pure documents. */

/** Flat export: three feeds directly under <body>, no folders. */
export const OPML_FLAT = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>My subscriptions</title></head>
  <body>
    <outline type="rss" text="Simon Willison" title="Simon Willison" xmlUrl="https://simonwillison.net/atom/everything/" htmlUrl="https://simonwillison.net/"/>
    <outline type="rss" text="Julia Evans" xmlUrl="https://jvns.ca/atom.xml"/>
    <outline type="rss" xmlUrl="https://martinfowler.com/feed.atom"/>
  </body>
</opml>
`;

/** Folders (incl. one nested) with entity-encoded titles, a dup, and a broken leaf. */
export const OPML_FOLDERS = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>Export</title></head>
  <body>
    <outline text="Science &amp; Tech" title="Science &amp; Tech">
      <outline type="rss" title="AT&amp;amp;T Blog" xmlUrl="https://example.com/att.xml"/>
      <outline type="rss" title="It&#39;s FOSS" xmlUrl="https://example.com/foss.xml"/>
      <outline text="Papers" title="Papers">
        <outline type="rss" title="arXiv cs.AI" xmlUrl="https://example.com/arxiv.xml"/>
      </outline>
      <outline type="rss" title="Broken entry"/>
    </outline>
    <outline text="News" title="News">
      <outline type="rss" title="Duplicate of AT&amp;T" xmlUrl="https://example.com/att.xml"/>
      <outline type="rss" title="The Verge" xmlUrl="https://example.com/verge.xml"/>
    </outline>
    <outline type="rss" title="Rootless" xmlUrl="https://example.com/root.xml"/>
  </body>
</opml>
`;

/** Five single-feed folders: forces the multi-row (column of rows) layout. */
export const OPML_MANY_FOLDERS = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="1.0">
  <body>
    <outline title="One"><outline title="a" xmlUrl="https://example.com/1.xml"/></outline>
    <outline title="Two"><outline title="b" xmlUrl="https://example.com/2.xml"/></outline>
    <outline title="Three"><outline title="c" xmlUrl="https://example.com/3.xml"/></outline>
    <outline title="Four"><outline title="d" xmlUrl="https://example.com/4.xml"/></outline>
    <outline title="Five"><outline title="e" xmlUrl="https://example.com/5.xml"/></outline>
  </body>
</opml>
`;

/** Well-formed XML that is not OPML (an RSS feed). */
export const NOT_OPML_RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel><title>A feed, not an export</title></channel></rss>
`;

/** OPML root without a <body>. */
export const OPML_NO_BODY = `<?xml version="1.0"?>
<opml version="2.0"><head><title>Empty</title></head></opml>
`;

/** OPML whose outlines have no xmlUrl anywhere. */
export const OPML_NO_FEEDS = `<?xml version="1.0"?>
<opml version="2.0">
  <body>
    <outline title="Folder"><outline title="Broken"/></outline>
  </body>
</opml>
`;
