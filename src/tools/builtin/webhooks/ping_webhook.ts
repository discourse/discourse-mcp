import { defineTool } from "../../definition.js";
import { jsonResponse } from "../../../util/json_response.js";
import { precondition, requireAdminWrite, webhookMutation, webhookMutationError, writeAnnotations } from "./common.js";
import { extractCatalog, projectWebhook, unwrapWebhook } from "./projections.js";
import { pingWebhookSchema } from "./schemas.js";

export const pingWebhookTool = defineTool({
  name: "discourse_ping_webhook", title: "Ping Webhook", description: "Enqueue one explicitly confirmed external webhook ping after a fresh destination precondition.", schema: pingWebhookSchema,
  availability: "writes_enabled", toolsets: ["webhooks"], annotations: writeAnnotations(false),
  handler: async ({ webhook_id, expected_destination_fingerprint }, _extra, ctx, opts) => {
    let attempted = false;
    try {
      const accessError = requireAdminWrite(ctx.siteState, opts); if (accessError) return accessError;
      const { base, client } = ctx.siteState.ensureSelectedSite(); const data: any = await client.get(`/admin/api/web_hooks/${webhook_id}.json`);
      const webhook = projectWebhook(unwrapWebhook(data), extractCatalog(data)); if (webhook.destination_fingerprint !== expected_destination_fingerprint) return precondition("Webhook destination changed", { webhook_id });
      await webhookMutation(base, async () => { attempted = true; await client.postNoRetry(`/admin/api/web_hooks/${webhook_id}/ping.json`, {}); });
      return jsonResponse({ enqueued: true, delivery_succeeded: null, webhook_id, guidance: "Inspect discourse_list_webhook_events for delivery status; enqueue success is not delivery success." });
    } catch (error) { return webhookMutationError("Failed to ping webhook", error, attempted); }
  },
});
