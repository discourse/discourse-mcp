import { z } from "zod";
import { defineTool } from "../../definition.js";
import { jsonResponse } from "../../../util/json_response.js";
import { readAnnotations, upstreamError } from "../common/helpers.js";
import { fetchReportCatalog, projectReportCatalog, requireAnalyticsAccess } from "./common.js";

export const listReportsTool = defineTool({
  name: "discourse_list_reports",
  title: "List Reports",
  description: "Discover staff-visible Discourse report identifiers and metadata. The catalog is authoritative because core and plugins can add or hide reports.",
  schema: z.object({}),
  availability: "always",
  toolsets: ["analytics"],
  annotations: readAnnotations(),
  handler: async (_input, _extra, ctx) => {
    const accessError = requireAnalyticsAccess(ctx);
    if (accessError) return accessError;
    try {
      const reports = projectReportCatalog(await fetchReportCatalog(ctx));
      return jsonResponse({ reports, meta: { total: reports.length, cached_seconds: 60 } });
    } catch (error) {
      return upstreamError("Failed to list reports", error);
    }
  },
});
