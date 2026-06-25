import type { AppConfig } from "./config/types";
import {
  exportStaticDashboard,
  renderStaticDashboard,
  type RenderStaticDashboardOptions,
  type StaticDashboardArtifact,
} from "./share-export";
import {
  formatGistPublishResult,
  publishGistArtifact,
  type GistPublishOptions,
  type GistPublishResult,
} from "./share-gist";

export {
  exportStaticDashboard,
  renderStaticDashboard,
  loadStaticDashboardPanelData,
  STATIC_DASHBOARD_CSS,
  STATIC_DASHBOARD_HTML,
} from "./share-export";
export type {
  ExportStaticDashboardOptions,
  RenderedStaticDashboard,
  RenderStaticDashboardOptions,
  StaticDashboardArtifact,
} from "./share-export";
export { formatGistPublishResult };
export type { GistPublishResult };
export type ExportStaticDashboardResult = StaticDashboardArtifact;

export type PublishStaticDashboardOptions = GistPublishOptions & RenderStaticDashboardOptions;

export async function publishStaticDashboardToGist(
  config: AppConfig,
  options: PublishStaticDashboardOptions,
): Promise<GistPublishResult> {
  const { html, css } = renderStaticDashboard(config, options);
  return publishGistArtifact({ html, css }, options);
}

export function formatExportStaticDashboardResult(result: StaticDashboardArtifact): string {
  return `exported: ${result.outputDir}\nhtml: ${result.htmlPath}\ncss: ${result.cssPath}`;
}
