import { requireAuthenticatedAccess } from "../../../util/access.js";
import type { ToolContext } from "../../types.js";
import { withRateLimit } from "../../../util/json_response.js";

export function requireAnalyticsAccess(ctx: ToolContext) {
  return requireAuthenticatedAccess(ctx.siteState);
}

export async function fetchReportCatalog(ctx: ToolContext) {
  const { base, client } = ctx.siteState.ensureSelectedSite();
  return await withRateLimit(`discourse-api:${base}`, () => client.getCached("/admin/reports.json", 60_000), 200) as any;
}

export interface ReportCatalogItem {
  type: string | null;
  title: string | null;
  description: string | null;
  description_link: string | null;
  plugin: string | null;
  plugin_display_name: string | null;
}

export function projectReportCatalog(data: any): ReportCatalogItem[] {
  return (Array.isArray(data?.reports) ? data.reports : []).map((report: any) => ({
    type: report?.type ?? null,
    title: report?.title ?? null,
    description: report?.description ?? null,
    description_link: report?.description_link ?? null,
    plugin: report?.plugin ?? null,
    plugin_display_name: report?.plugin_display_name ?? null,
  }));
}
