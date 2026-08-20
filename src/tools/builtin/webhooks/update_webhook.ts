import { defineTool } from "../../definition.js";
import { jsonError, jsonResponse } from "../../../util/json_response.js";
import { contentTypeId, fetchCatalog, validateDestination, validateEvents, validateSubscription, webhookFromResponse } from "./authoring.js";
import { precondition, requireAdminWrite, webhookMutation, webhookMutationError, writeAnnotations } from "./common.js";
import { extractCatalog, projectWebhook, unwrapWebhook } from "./projections.js";
import { updateWebhookSchema } from "./schemas.js";

const mutable = ["payload_url", "content_type", "secret", "active", "verify_certificate", "wildcard_web_hook", "event_type_ids", "category_ids", "tag_ids", "group_ids"] as const;
const relationships = ["event_type_ids", "category_ids", "tag_ids", "group_ids"] as const;
function sameIds(a: unknown, b: unknown) { const x = Array.isArray(a) ? a.map(Number).sort((m,n)=>m-n) : []; const y = Array.isArray(b) ? b.map((v:any)=>Number(v?.id ?? v)).sort((m,n)=>m-n) : []; return JSON.stringify(x) === JSON.stringify(y); }

export const updateWebhookTool = defineTool({
  name: "discourse_update_webhook", title: "Update Webhook", description: "Partially update a webhook after fresh destination and active-state preconditions. Relationship arrays are complete replacements.", schema: updateWebhookSchema,
  availability: "writes_enabled", toolsets: ["webhooks"], annotations: writeAnnotations(true),
  handler: async (input, _extra, ctx, opts) => {
    let attempted = false;
    try {
      const accessError = requireAdminWrite(ctx.siteState, opts); if (accessError) return accessError;
      const requested = mutable.filter((key) => input[key] !== undefined); if (!requested.length) return jsonError("At least one mutable field is required", { code: "no_change" });
      if (input.secret !== undefined && input.secret !== "" && input.secret.length < 12) return jsonError("A non-empty webhook secret must be at least 12 characters", { code: "invalid_parameters" });
      if (input.secret === "" && input.confirm_clear_secret !== true) return jsonError("Clearing the webhook secret requires confirm_clear_secret=true", { code: "confirmation_required" });
      if (input.payload_url !== undefined) { const error = validateDestination(input.payload_url, input.confirm_insecure_http); if (error) return jsonError(error, { code: "invalid_parameters" }); }
      const { base, client } = ctx.siteState.ensureSelectedSite();
      const freshData: any = await client.get(`/admin/api/web_hooks/${input.webhook_id}.json`); const raw = unwrapWebhook(freshData); const beforeIdentity = projectWebhook(raw, extractCatalog(freshData));
      if (beforeIdentity.destination_fingerprint !== input.expected_destination_fingerprint || beforeIdentity.active !== input.expected_active) return precondition("Webhook destination or active state changed", { webhook_id: input.webhook_id });
      if (input.active === true && beforeIdentity.active !== true && input.confirm_activate !== true) return jsonError("Activation requires confirm_activate=true", { code: "confirmation_required" });
      if (input.verify_certificate === false && raw?.verify_certificate !== false && input.confirm_disable_tls_verification !== true) return jsonError("Disabling TLS verification requires confirmation", { code: "confirmation_required" });
      const currentIds: Record<string, unknown> = { event_type_ids: raw?.web_hook_event_type_ids ?? raw?.web_hook_event_types, category_ids: raw?.category_ids ?? raw?.categories, tag_ids: raw?.tag_ids ?? raw?.tags, group_ids: raw?.group_ids ?? raw?.groups };
      const changedRelationships = relationships.filter((key) => input[key] !== undefined && !sameIds(input[key], currentIds[key]));
      if (changedRelationships.length && input.confirm_scope_replacement !== true) return jsonError("Relationship replacements require confirm_scope_replacement=true", { code: "confirmation_required", fields: changedRelationships });
      const catalog = await fetchCatalog(client);
      const resolvedContentType = input.content_type !== undefined ? contentTypeId(catalog, input.content_type) : undefined;
      if (input.content_type !== undefined && resolvedContentType === null) return jsonError("The selected content type is absent from the live catalog", { code: "invalid_parameters" });
      const scalarChanged = input.secret !== undefined ||
        (input.payload_url !== undefined && input.payload_url !== raw?.payload_url) ||
        (input.content_type !== undefined && resolvedContentType !== Number(raw?.content_type)) ||
        (input.active !== undefined && input.active !== (raw?.active === true)) ||
        (input.verify_certificate !== undefined && input.verify_certificate !== (raw?.verify_certificate !== false)) ||
        (input.wildcard_web_hook !== undefined && input.wildcard_web_hook !== (raw?.wildcard_web_hook === true));
      if (!scalarChanged && changedRelationships.length === 0) return jsonError("The requested mutation is a no-op", { code: "no_change" });
      const targetWildcard = input.wildcard_web_hook ?? (raw?.wildcard_web_hook === true); const targetEvents = input.event_type_ids ?? (Array.isArray(currentIds.event_type_ids) ? (currentIds.event_type_ids as any[]).map((v:any)=>Number(v?.id ?? v)) : []);
      if (input.wildcard_web_hook !== undefined || input.event_type_ids !== undefined) { const error = validateSubscription({ wildcard_web_hook: targetWildcard, event_type_ids: targetEvents, confirm_wildcard: input.confirm_wildcard }); if (error) return error; const unknown = validateEvents(catalog, targetEvents); if (unknown.length) return jsonError("Unknown webhook event type IDs", { code: "invalid_parameters", unknown_event_type_ids: unknown }); }
      const web_hook: Record<string, unknown> = {};
      if (input.payload_url !== undefined) web_hook.payload_url = input.payload_url;
      if (input.content_type !== undefined) web_hook.content_type = resolvedContentType;
      for (const key of ["secret", "active", "verify_certificate", "wildcard_web_hook"] as const) if (input[key] !== undefined) web_hook[key] = input[key];
      if (input.event_type_ids !== undefined) web_hook.web_hook_event_type_ids = input.event_type_ids;
      for (const key of ["category_ids", "tag_ids", "group_ids"] as const) if (input[key] !== undefined) web_hook[key] = input[key];
      let response: any; await webhookMutation(base, async () => { attempted = true; response = await client.putNoRetry(`/admin/api/web_hooks/${input.webhook_id}.json`, { web_hook }); });
      const before = projectWebhook(raw, catalog);
      return jsonResponse({ updated: true, before, after: projectWebhook(webhookFromResponse(response), catalog), requested_fields: requested });
    } catch (error) { return webhookMutationError("Failed to update webhook", error, attempted); }
  },
});
