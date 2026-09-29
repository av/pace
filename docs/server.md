# Server configuration

How to run pace as a long-lived server: port, config path, environment variables, the `server:` config block, reverse proxies, data retention, and health checks. Docker specifics (container user, upgrades, healthcheck) are in [install.md](install.md#docker).

Port and config path come from the CLI or environment:

- `pace serve --port 8080` (or `-p 8080`), or the `PORT` env var. Default: `7453`.
- `pace serve --config config.yaml`, `--preset <name>`, or the `PACE_CONFIG` env var.
- `PACE_DB_PATH` env var overrides the SQLite database location. Default: `data/pace.db` under the working directory.

An optional top-level `server` block in `config.yaml` controls server behavior (unknown fields are rejected at validation):

```yaml
server:
  base_path: /pace     # serve the dashboard under a URL prefix (default: none)
  retention_days: 30   # days to keep fetched items in SQLite (default: 30; 0 disables pruning)
```

## `server.base_path` - reverse proxy subpath

Set `base_path` when pace runs behind a reverse proxy under a subpath (for example `https://example.com/pace/`). Pages, static assets, and refresh redirects are all generated with the prefix. The value is normalized on load: a leading `/` is added if missing and a trailing `/` is stripped (`pace/` becomes `/pace`).

Pace answers both at the prefix and at the root, so it works whether or not your proxy strips the prefix before forwarding:

```nginx
# Prefix preserved by the proxy:
location /pace/ { proxy_pass http://127.0.0.1:7453; }

# Prefix stripped by the proxy:
location /pace/ { proxy_pass http://127.0.0.1:7453/; }
```

## `server.retention_days` - item retention

Fetched items live in SQLite so panels stay populated across restarts and upstream outages. Items last fetched more than `retention_days` days ago are pruned at startup and then once every 24 hours. Set `0` to disable pruning entirely (the log notes when pruning is disabled). Must be a non-negative integer; the default is 30.

The database (`data/pace.db`) is a cache: deleting it is always safe, and contents are re-fetched on the next refresh. The schema is migrated automatically on startup when a newer pace version changes it; to downgrade across a schema change, delete the database or restore a pre-upgrade copy (see the [changelog](../CHANGELOG.md) for version specifics).

## `/health` - liveness and refresh health

`GET /health` returns JSON with an overall `status` and per-source refresh detail:

```json
{
  "status": "degraded",
  "sources": [
    { "kind": "adapter", "name": "hackernews", "status": "ok", "lastSuccessAt": "2026-07-08T00:00:00.000Z", "lastDurationMs": 412, "lastItemCount": 30 },
    { "kind": "adapter", "name": "myfeed", "status": "failing", "lastError": "rss: error fetching ...", "lastFailureAt": "2026-07-08T00:05:00.000Z", "lastDurationMs": 5003 }
  ]
}
```

`status` is `degraded` when any source's latest completed run failed; per-source `status` is `ok`, `failing`, or `pending` (no run completed yet, e.g. right after startup). Per-source extras appear once available: `lastError` (message from the most recent failure), `lastDurationMs` (duration of the latest completed run, success or failure), and `lastItemCount` (items produced by the latest successful run — fetched items for adapters, gathered input items for pipelines — retained through later failures as context). The HTTP status stays `200` as long as the server is up — it serves cached data even when upstreams fail, and a restart would not fix a bad upstream — so container healthchecks keep passing while monitors can alert on the body.

The `server:` block also takes `auto_mark_seen` and `hide_seen`, which change how the dashboard tracks read items; see [dashboard.md](dashboard.md).
