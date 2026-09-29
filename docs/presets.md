# Presets and example dashboards

## Presets

### Preset showcase

| | | | |
|:---:|:---:|:---:|:---:|
| [![Tech News preset](../assets/preset-tech-news.png)](../presets/config.tech-news.yaml) | [![ML & AI preset](../assets/preset-ml-ai.png)](../presets/config.ml-ai.yaml) | [![Daily Brief preset](../assets/preset-daily-brief.png)](../presets/config.daily-brief.yaml) | [![Product Launches preset](../assets/preset-product-launches.png)](../presets/config.product-launches.yaml) |
| [`tech-news`](../presets/config.tech-news.yaml) | [`ml-ai`](../presets/config.ml-ai.yaml) | [`daily-brief`](../presets/config.daily-brief.yaml) | [`product-launches`](../presets/config.product-launches.yaml) |
| [![Academic Papers preset](../assets/preset-academic-papers.png)](../presets/config.academic-papers.yaml) | [![Release Tracker preset](../assets/preset-release-tracker.png)](../presets/config.release-tracker.yaml) | [![Video & Podcast preset](../assets/preset-video-podcast.png)](../presets/config.video-podcast.yaml) | |
| [`academic-papers`](../presets/config.academic-papers.yaml) | [`release-tracker`](../presets/config.release-tracker.yaml) | [`video-podcast`](../presets/config.video-podcast.yaml) | |

Presets are bundled in the Docker image and selectable with a single flag (`--preset tech-news` or `-P ml-ai`; see `pace --list-presets`).

Available presets:

| Preset | Focus |
|--------|-------|
| `tech-news` | Tech news: HN + Lobsters frontpage, Lemmy communities, news/blogs, releases |
| `ml-ai` | AI and machine learning: arXiv papers, local-LLM community, releases, curated blogs |
| `daily-brief` | Morning briefing: world headlines, Wikipedia in-the-news/most-read, big HN stories |
| `product-launches` | Product launches: Product Hunt, Show HN, trending repos, fresh npm packages |
| `release-tracker` | Software release tracking |
| `academic-papers` | Academic papers: arXiv, CS theory Q&A, science journalism |
| `video-podcast` | Video and podcast content |

List presets: `pace presets list` (or `pace --list-presets`).

## Example dashboards

These are reference dashboards: useful for seeing what pace can express, studying layout patterns, and adapting a config by hand. For ready-to-run starting points, use the [presets](#presets) above.

| | | | |
|:---:|:---:|:---:|:---:|
| [![Morning Brief](../examples/morning-brief.png)](../examples/morning-brief.yaml) | [![Dev Radar](../examples/dev-radar.png)](../examples/dev-radar.yaml) | [![Indie Web](../examples/indie-web.png)](../examples/indie-web.yaml) | [![Open Source Launchpad](../examples/open-source-launchpad.png)](../examples/open-source-launchpad.yaml) |
| [Morning Brief](../examples/morning-brief.yaml) | [Dev Radar](../examples/dev-radar.yaml) | [Indie Web](../examples/indie-web.yaml) | [Open Source Launchpad](../examples/open-source-launchpad.yaml) |
| [![Release Cockpit](../examples/release-cockpit.png)](../examples/release-cockpit.yaml) | [![Science Desk](../examples/science-desk.png)](../examples/science-desk.yaml) | [![Layout System](../examples/layout-system.png)](../examples/layout-system.yaml) | [![Widgets Gallery](../examples/widgets-gallery.png)](../examples/widgets-gallery.yaml) |
| [Release Cockpit](../examples/release-cockpit.yaml) | [Science Desk](../examples/science-desk.yaml) | [Layout System](../examples/layout-system.yaml) | [Widgets Gallery](../examples/widgets-gallery.yaml) |

<p align="center">Example layouts above. Use the paths in [install.md](install.md) to run pace with agent skills, Docker, or source.</p>
