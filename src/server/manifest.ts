import { THEME_COLORS } from "../dashboard.js";

/** Content type for the web app manifest (RFC-registered for manifests). */
export const MANIFEST_CONTENT_TYPE = "application/manifest+json";

/**
 * The pace web app manifest, so the dashboard installs as a home-screen /
 * standalone app (Android "Add to Home screen", desktop Chrome "Install",
 * iOS Safari share-sheet). Pure function of the base path: `id`/`start_url`/
 * `scope` all live under it so multiple pace instances behind one origin
 * install as distinct apps, and the icon reuses the served /favicon.svg
 * monogram. Colors mirror THEME_COLORS.dark — the same dark default the
 * dashboard's theme-color metas declare — so the splash screen and window
 * chrome match the palette.
 */
export function webAppManifest(basePath = ""): Record<string, unknown> {
  const startUrl = `${basePath}/`;
  return {
    name: "pace",
    short_name: "pace",
    description: "Personal dashboard for the things you follow",
    id: startUrl,
    start_url: startUrl,
    scope: startUrl,
    display: "standalone",
    background_color: THEME_COLORS.dark,
    theme_color: THEME_COLORS.dark,
    icons: [
      {
        src: `${basePath}/favicon.svg`,
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
