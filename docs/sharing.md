# Share a snapshot

Pace can turn the current dashboard into static files, so you can share a dashboard without exposing or operating a public pace server.

```bash
pace share export pace-share
```

That writes `pace-share/index.html` and `pace-share/styles.css` for local review or manual upload.
For email, chat, or other one-file transfers, use `pace share export pace-share --single-file`;
the resulting `index.html` includes its stylesheet and can be moved by itself.
Exported pages follow the viewer's OS light/dark preference (`prefers-color-scheme`) with the same palettes the interactive theme toggle uses — no JavaScript required.

Publish the same snapshot to GitHub Gist and get a browser-rendered URL:

```bash
GITHUB_TOKEN=... pace share gist   # GH_TOKEN works too
```

Useful options:

- `--gist-id <id>` or `--update <id>` updates an existing Gist so the share URL stays stable.
- `--public` creates a public Gist; the default is secret/unlisted.
- `--renderer-url <url>` switches from the default `https://gisthost.github.io/` renderer to another compatible Gist renderer.

Static snapshots are read-only: refresh controls, the keyboard-navigation script, and server-only routes are omitted, and unresolved environment placeholders are rejected instead of being published.
