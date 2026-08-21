import { z } from "zod";
import { defineTool } from "../../definition.js";
import { jsonError, jsonResponse, withRateLimit } from "../../../util/json_response.js";
import { readAnnotations, upstreamError } from "../common/helpers.js";
import { fetchReportCatalog, projectReportCatalog, requireAnalyticsAccess } from "./common.js";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
const filterValue = z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number(), z.boolean()]))]);
const schema = z.object({
  report_type: z.string().regex(/^[a-z0-9_]+$/),
  start_date: isoDate.optional(),
  end_date: isoDate.optional(),
  facets: z.array(z.string().min(1)).max(20).optional(),
  filters: z.record(filterValue).optional(),
  limit: z.number().int().min(1).max(50).optional(),
  cache: z.boolean().optional(),
});

export const getReportTool = defineTool({
  name: "discourse_get_report",
  title: "Get Report",
  description: "Execute one discovered staff-visible Discourse report with dates, facets, typed filters, limit, and upstream caching. This exposes existing reports, not arbitrary SQL.",
  schema,
  availability: "always",
  toolsets: ["analytics"],
  annotations: readAnnotations(),
  handler: async ({ report_type, start_date, end_date, facets, filters, limit, cache }, _extra, ctx) => {
    const accessError = requireAnalyticsAccess(ctx);
    if (accessError) return accessError;
    try {
      const visible = projectReportCatalog(await fetchReportCatalog(ctx));
      if (!visible.some((report) => report.type === report_type)) return jsonError("Report is not present in the visible report catalog", { code: "report_not_discovered", report_type });
      const query: Record<string, unknown> = { start_date, end_date, facets, limit, cache };
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined) continue;
        if (Array.isArray(value)) value.forEach((item) => params.append(`${key}[]`, String(item)));
        else params.set(key, String(value));
      }
      for (const [key, value] of Object.entries(filters ?? {})) {
        if (Array.isArray(value)) value.forEach((item) => params.append(`filters[${key}][]`, String(item)));
        else params.set(`filters[${key}]`, String(value));
      }
      const suffix = params.toString() ? `?${params.toString()}` : "";
      const { base, client } = ctx.siteState.ensureSelectedSite();
      const data = await withRateLimit(`discourse-api:${base}`, () => client.get(`/admin/reports/${report_type}.json${suffix}`), 200) as any;
      return jsonResponse({ report: data?.report ?? data, meta: { discovered: true, cache_requested: cache ?? false } });
    } catch (error) {
      return upstreamError(`Failed to get report ${report_type}`, error);
    }
  },
});
