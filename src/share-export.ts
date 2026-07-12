import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AppConfig } from "./config/types";
import { loadDashboardPanelDataMap } from "./db";
import { formatDashboardUpdatedAt, renderDashboard, type PanelData } from "./layout";
import { buildLayoutRuntimeMaps } from "./layout/types";
import { DEFAULT_SRC_DIR, readBundledText } from "./server/static";
import { errorMessage, getAdapterName } from "./utils";

export const STATIC_DASHBOARD_HTML = "index.html";
export const STATIC_DASHBOARD_CSS = "styles.css";

export interface StaticDashboardArtifact {
  outputDir: string;
  htmlPath: string;
  cssPath?: string;
  files: string[];
  updatedAt: string;
}

export interface RenderStaticDashboardOptions {
  now?: Date;
  srcDir?: string;
  panelData?: Map<string, PanelData>;
  singleFile?: boolean;
}

export interface RenderedStaticDashboard {
  html: string;
  css: string;
  updatedAt: string;
}

export interface ExportStaticDashboardOptions extends RenderStaticDashboardOptions {
  outputDir: string;
}

const ENV_PLACEHOLDER = /\$\{[^}]*\}/;

function collectStrings(node: unknown, out: string[]): void {
  if (typeof node === "string") {
    out.push(node);
  } else if (Array.isArray(node)) {
    for (const child of node) collectStrings(child, out);
  } else if (node && typeof node === "object") {
    for (const value of Object.values(node)) collectStrings(value, out);
  }
}

/**
 * Guards against unresolved `${VAR}` config placeholders leaking into a shared
 * artifact. Only config-derived strings (layout) and the bundled CSS are
 * scanned — NOT the rendered HTML, which embeds untrusted feed content where
 * `${...}` is legitimate text (shell snippets, JS template literals, etc.).
 * Config loaded via loadConfig() already rejects unresolved placeholders; this
 * covers programmatic AppConfig construction and customized CSS.
 */
function assertNoUnresolvedEnvPlaceholders(config: AppConfig, css: string): void {
  const contents: string[] = [css];
  collectStrings(config.layout, contents);
  for (const content of contents) {
    const match = content.match(ENV_PLACEHOLDER);
    if (match) {
      throw new Error(`share: static dashboard contains unresolved env placeholder ${match[0]}`);
    }
  }
}

export function loadStaticDashboardPanelData(config: AppConfig): Map<string, PanelData> {
  const adapterNames = config.adapters.map(getAdapterName);
  const { dashboardPanels } = buildLayoutRuntimeMaps(config.layout, adapterNames, config.pipelines);
  return loadDashboardPanelDataMap(dashboardPanels);
}

export function renderStaticDashboard(
  config: AppConfig,
  options: RenderStaticDashboardOptions = {},
): RenderedStaticDashboard {
  const updatedAt = formatDashboardUpdatedAt(options.now);
  const panelData = options.panelData ?? loadStaticDashboardPanelData(config);
  const css = readBundledText(options.srcDir ?? DEFAULT_SRC_DIR, STATIC_DASHBOARD_CSS);
  assertNoUnresolvedEnvPlaceholders(config, css);
  let html = renderDashboard({
    layout: config.layout,
    panelData,
    updatedAt,
    cssHref: STATIC_DASHBOARD_CSS,
    mode: "static",
  });
  if (options.singleFile) {
    html = html.replace(
      `<link rel="stylesheet" href="${STATIC_DASHBOARD_CSS}"/>`,
      `<style>${css.replace(/<\/style/gi, "<\\/style")}</style>`,
    );
  }

  return { html, css, updatedAt };
}

export function exportStaticDashboard(
  config: AppConfig,
  options: ExportStaticDashboardOptions,
): StaticDashboardArtifact {
  try {
    const rendered = renderStaticDashboard(config, options);
    mkdirSync(options.outputDir, { recursive: true });

    const htmlPath = join(options.outputDir, STATIC_DASHBOARD_HTML);
    const cssPath = join(options.outputDir, STATIC_DASHBOARD_CSS);
    writeFileSync(htmlPath, rendered.html);
    if (!options.singleFile) writeFileSync(cssPath, rendered.css);

    return {
      outputDir: options.outputDir,
      htmlPath,
      cssPath: options.singleFile ? undefined : cssPath,
      files: options.singleFile
        ? [STATIC_DASHBOARD_HTML]
        : [STATIC_DASHBOARD_HTML, STATIC_DASHBOARD_CSS],
      updatedAt: rendered.updatedAt,
    };
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("share:")) throw err;
    throw new Error(`share: failed to export static dashboard: ${errorMessage(err)}`);
  }
}
