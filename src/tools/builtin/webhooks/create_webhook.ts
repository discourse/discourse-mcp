import { defineTool } from "../../definition.js";
import { jsonError, jsonResponse } from "../../../util/json_response.js";
import { contentTypeId, fetchCatalog, validateDestination, validateEvents, validateSubscription, webhookFromResponse } from "./authoring.js";
import { requireAdminWrite, webhookMutation, webhookMutationError, writeAnnotations } from "./common.js";
import { projectWebhook } from "./projections.js";
import { createWebhookSchema } from "./schemas.js";

export const createWebhookTool = defineTool({
  name: "discourse_create_webhook", title: "Create Webhook", description: "Create a guarded outbound webhook using the live event and content-type catalog. External delivery and risky options require explicit confirmation.", schema: createWebhookSchema,
  availability: "writes_enabled", toolsets: ["webhooks"], annotations: writeAnnotations(false),
  handler: async (input, _extra, ctx, opts) => {
    let attempted = false;
    try {
      const accessError = requireAdminWrite(ctx.siteState, opts); if (accessError) return accessError;
      const destinationError = validateDestination(input.payload_url, input.confirm_insecure_http); if (destinationError) return jsonError(destinationError, { code: "invalid_parameters" });
      const active = input.active ?? false, verify = input.verify_certificate ?? true, wildcard = input.wildcard_web_hook ?? false, events = input.event_type_ids ?? [];
      if (active && input.confirm_activate !== true) return jsonError("Active creation requires confirm_activate=true", { code: "confirmation_required" });
      if (!verify && input.confirm_disable_tls_verification !== true) return jsonError("Disabling TLS verification requires confirmation", { code: "confirmation_required" });
      const subscriptionError = validateSubscription({ wildcard_web_hook: wildcard, event_type_ids: events, confirm_wildcard: input.confirm_wildcard }); if (subscriptionError) return subscriptionError;
      const { base, client } = ctx.siteState.ensureSelectedSite(); const catalog = await fetchCatalog(client);
      const contentType = contentTypeId(catalog, input.content_type); if (contentType === null) return jsonError("The selected content type is absent from the live catalog", { code: "invalid_parameters" });
      const unknown = validateEvents(catalog, events); if (unknown.length) return jsonError("Unknown webhook event type IDs", { code: "invalid_parameters", unknown_event_type_ids: unknown });
      const web_hook: Record<string, unknown> = { payload_url: input.payload_url, content_type: contentType, active, verify_certificate: verify, wildcard_web_hook: wildcard, web_hook_event_type_ids: events, category_ids: input.category_ids ?? [], tag_ids: input.tag_ids ?? [], group_ids: input.group_ids ?? [] };
      if (input.secret !== undefined) web_hook.secret = input.secret;
      let response: any;
      await webhookMutation(base, async () => { attempted = true; response = await client.postNoRetry("/admin/api/web_hooks.json", { web_hook }); });
      return jsonResponse({ created: true, webhook: projectWebhook(webhookFromResponse(response), catalog) });
    } catch (error) { return webhookMutationError("Failed to create webhook", error, attempted); }
  },
});
