import { defineTool } from "../../definition.js";
import { jsonResponse } from "../../../util/json_response.js";
import { precondition, requireAdminWrite, webhookMutation, webhookMutationError, writeAnnotations } from "./common.js";
import { extractCatalog, projectWebhook, unwrapWebhook } from "./projections.js";
import { deleteWebhookSchema } from "./schemas.js";

export const deleteWebhookTool = defineTool({
  name: "discourse_delete_webhook", title: "Delete Webhook", description: "Delete one webhook after a fresh exact destination-fingerprint precondition.", schema: deleteWebhookSchema,
  availability: "writes_enabled", toolsets: ["webhooks"], annotations: writeAnnotations(true),
  handler: async ({ webhook_id, expected_destination_fingerprint }, _extra, ctx, opts) => {
    let attempted = false;
    try {
      const accessError = requireAdminWrite(ctx.siteState, opts); if (accessError) return accessError;
      const { base, client } = ctx.siteState.ensureSelectedSite(); const data: any = await client.get(`/admin/api/web_hooks/${webhook_id}.json`);
      const webhook = projectWebhook(unwrapWebhook(data), extractCatalog(data)); if (webhook.destination_fingerprint !== expected_destination_fingerprint) return precondition("Webhook destination changed", { webhook_id });
      await webhookMutation(base, async () => { attempted = true; await client.deleteNoRetry(`/admin/api/web_hooks/${webhook_id}.json`); });
      return jsonResponse({ deleted: true, webhook_id, sanitized_payload_url: webhook.payload_url, destination_fingerprint: webhook.destination_fingerprint });
    } catch (error) { return webhookMutationError("Failed to delete webhook", error, attempted); }
  },
});
