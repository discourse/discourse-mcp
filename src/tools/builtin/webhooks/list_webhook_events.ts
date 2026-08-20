import { defineTool } from "../../definition.js";
import { jsonError, jsonResponse } from "../../../util/json_response.js";
import { queryString, readAnnotations, upstreamError } from "../common/helpers.js";
import { requireAdminRead } from "./common.js";
import { projectWebhookEvent } from "./projections.js";
import { listWebhookEventsSchema } from "./schemas.js";

export const listWebhookEventsTool = defineTool({
  name: "discourse_list_webhook_events", title: "List Webhook Events", description: "List bounded webhook delivery diagnostics. Payload and response previews are omitted unless explicitly confirmed.", schema: listWebhookEventsSchema,
  availability: "always", toolsets: ["webhooks"], annotations: readAnnotations(),
  handler: async ({ webhook_id, status = "all", offset = 0, include_content = false, confirm_sensitive_content, content_limit = 4_000 }, _extra, ctx) => {
    try {
      const accessError = requireAdminRead(ctx.siteState); if (accessError) return accessError;
      if (include_content && confirm_sensitive_content !== true) return jsonError("Sensitive content requires confirm_sensitive_content=true", { code: "confirmation_required" });
      const { client } = ctx.siteState.ensureSelectedSite();
      const data: any = await client.get(`/admin/api/web_hook_events/${webhook_id}.json${queryString({ status, offset })}`);
      const source = Array.isArray(data?.web_hook_events) ? data.web_hook_events : [];
      const events = source.map((event: any) => projectWebhookEvent(event, include_content, Math.min(content_limit, ctx.maxReadLength)));
      const total = Number(data?.total_rows_web_hook_events); const hasMore = Number.isFinite(total) ? offset + 50 < total : source.length === 50;
      return jsonResponse({ events, meta: { offset, returned: events.length, upstream_total: Number.isFinite(total) ? total : null, next_offset: hasMore ? offset + 50 : null } });
    } catch (error) { return upstreamError("Failed to list webhook events", error); }
  },
});
