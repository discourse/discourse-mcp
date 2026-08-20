import { defineTool } from "../../definition.js";
import { HttpError } from "../../../http/client.js";
import { jsonError, jsonResponse } from "../../../util/json_response.js";
import { queryString } from "../common/helpers.js";
import { precondition, requireAdminWrite, webhookMutation, webhookMutationError, writeAnnotations } from "./common.js";
import { extractCatalog, projectWebhook, projectWebhookEvent, unwrapWebhook } from "./projections.js";
import { redeliverWebhookEventSchema } from "./schemas.js";

function eventRows(data: any): any[] { const rows = data?.web_hook_events ?? data?.events; return Array.isArray(rows) ? rows : Array.isArray(data) ? data : []; }
export const redeliverWebhookEventTool = defineTool({
  name: "discourse_redeliver_webhook_event", title: "Redeliver Webhook Event", description: "Redeliver exactly one old webhook event after destination, ownership, and status preconditions. Bulk redelivery is not exposed.", schema: redeliverWebhookEventSchema,
  availability: "writes_enabled", toolsets: ["webhooks"], annotations: writeAnnotations(true),
  handler: async ({ webhook_id, event_id, expected_destination_fingerprint, expected_event_status }, _extra, ctx, opts) => {
    let attempted = false;
    try {
      const accessError = requireAdminWrite(ctx.siteState, opts); if (accessError) return accessError;
      const { base, client } = ctx.siteState.ensureSelectedSite(); const hookData: any = await client.get(`/admin/api/web_hooks/${webhook_id}.json`);
      const hook = projectWebhook(unwrapWebhook(hookData), extractCatalog(hookData)); if (hook.destination_fingerprint !== expected_destination_fingerprint) return precondition("Webhook destination changed", { webhook_id });
      let eventData: any;
      try { eventData = await client.get(`/admin/api/web_hooks/${webhook_id}/events/bulk.json${queryString({ ids: [event_id] })}`); }
      catch (error) { if (error instanceof HttpError && error.status === 404) return jsonError("The event does not belong to this webhook or is unavailable", { code: "event_not_owned", status: 404, webhook_id, event_id }); throw error; }
      const matches = eventRows(eventData).filter((event) => Number(event?.id) === event_id && Number(event?.web_hook_id ?? event?.webhook_id ?? webhook_id) === webhook_id);
      if (matches.length !== 1) return jsonError("The event does not belong to this webhook or is unavailable", { code: "event_not_owned", webhook_id, event_id });
      const event = matches[0]; if (Number(event?.status) !== expected_event_status) return precondition("Webhook event status changed", { webhook_id, event_id });
      if (Number(event?.status) === 0) return jsonError("Ping events must be sent with discourse_ping_webhook", { code: "invalid_parameters" });
      let response: any; await webhookMutation(base, async () => { attempted = true; response = await client.postNoRetry(`/admin/api/web_hooks/${webhook_id}/events/${event_id}/redeliver.json`, {}); });
      const result = eventRows(response)[0] ?? response?.web_hook_event ?? response;
      return jsonResponse({ redelivered: true, webhook_id, event_id, event: projectWebhookEvent(result, false, 1_000), delivery_guaranteed: false });
    } catch (error) { return webhookMutationError("Failed to redeliver webhook event", error, attempted); }
  },
});
