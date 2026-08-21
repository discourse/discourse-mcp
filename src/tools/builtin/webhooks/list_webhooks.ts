import { defineTool } from "../../definition.js";
import { jsonResponse } from "../../../util/json_response.js";
import { queryString, readAnnotations, upstreamError } from "../common/helpers.js";
import { requireAdminRead } from "./common.js";
import { extractCatalog, projectWebhook, webhookRows } from "./projections.js";
import { listWebhooksSchema } from "./schemas.js";

export const listWebhooksTool = defineTool({
  name: "discourse_list_webhooks", title: "List Webhooks", description: "List safe webhook summaries and the live authoring catalog without exposing webhook secrets or destination credentials.", schema: listWebhooksSchema,
  availability: "always", toolsets: ["webhooks"], annotations: readAnnotations(),
  handler: async ({ offset = 0, limit = 50, active, delivery_status, include_catalog = true }, _extra, ctx) => {
    try {
      const accessError = requireAdminRead(ctx.siteState); if (accessError) return accessError;
      const { client } = ctx.siteState.ensureSelectedSite();
      const data: any = await client.get(`/admin/api/web_hooks.json${queryString({ offset })}`);
      const catalog = extractCatalog(data);
      let rows = webhookRows(data).map((row) => projectWebhook(row, catalog));
      if (active !== undefined) rows = rows.filter((row) => row.active === active);
      if (delivery_status) rows = rows.filter((row) => row.last_delivery_status.name === delivery_status);
      const matchingInPage = rows.length;
      rows = rows.slice(0, limit);
      const total = Number(data?.total_rows_web_hooks);
      const pageTruncated = matchingInPage > limit;
      const hasMore = Number.isFinite(total) ? offset + 50 < total : webhookRows(data).length === 50;
      return jsonResponse({ webhooks: rows, ...(include_catalog ? { catalog } : {}), meta: { offset, limit, returned: rows.length, matching_in_upstream_page: matchingInPage, upstream_total: Number.isFinite(total) ? total : null, local_filters_applied: active !== undefined || delivery_status !== undefined, page_truncated: pageTruncated, next_offset: pageTruncated ? null : hasMore ? offset + 50 : null, guidance: pageTruncated ? "Increase limit to inspect all matching rows in this upstream page before continuing." : null } });
    } catch (error) { return upstreamError("Failed to list webhooks", error); }
  },
});
