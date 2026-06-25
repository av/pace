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
  cssPath: string;
  files: string[];
  updatedAt: string;
}

export interface RenderStaticDashboardOptions {
  now?: Date;
  srcDir?: string;
  panelData?: Map<string, PanelData>;
}

export interface RenderedStaticDashboard {
  html: string;
  css: string;
  updatedAt: string;
}

export interface ExportStaticDashboardOptions extends RenderStaticDashboardOptions {
  outputDir: string;
}

function assertNoUnresolvedEnvPlaceholders(...contents: string[]): void {
  const match = contents.map((content) => content.match(/\$\{[^}]*\}/)).find(Boolean);
  if (match) {
    throw new Error(`share: static dashboard contains unresolved env placeholder ${match[0]}`);
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
  const html = renderDashboard({
    layout: config.layout,
    panelData,
    updatedAt,
    cssHref: STATIC_DASHBOARD_CSS,
    mode: "static",
  });

  assertNoUnresolvedEnvPlaceholders(html, css);
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
    writeFileSync(cssPath, rendered.css);

    return {
      outputDir: options.outputDir,
      htmlPath,
      cssPath,
      files: [STATIC_DASHBOARD_HTML, STATIC_DASHBOARD_CSS],
      updatedAt: rendered.updatedAt,
    };
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("share:")) throw err;
    throw new Error(`share: failed to export static dashboard: ${errorMessage(err)}`);
  }
}
