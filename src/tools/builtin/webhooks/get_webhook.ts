import { defineTool } from "../../definition.js";
import { jsonResponse } from "../../../util/json_response.js";
import { readAnnotations, upstreamError } from "../common/helpers.js";
import { requireAdminRead } from "./common.js";
import { fetchCatalog } from "./authoring.js";
import { extractCatalog, projectWebhook, unwrapWebhook } from "./projections.js";
import { getWebhookSchema } from "./schemas.js";

export const getWebhookTool = defineTool({
  name: "discourse_get_webhook", title: "Get Webhook", description: "Get one fresh safe webhook configuration for inspection and mutation preconditions.", schema: getWebhookSchema,
  availability: "always", toolsets: ["webhooks"], annotations: readAnnotations(),
  handler: async ({ webhook_id, include_catalog = false }, _extra, ctx) => {
    try {
      const accessError = requireAdminRead(ctx.siteState); if (accessError) return accessError;
      const { client } = ctx.siteState.ensureSelectedSite();
      const data: any = await client.get(`/admin/api/web_hooks/${webhook_id}.json`);
      const catalog = include_catalog ? await fetchCatalog(client) : extractCatalog(data);
      return jsonResponse({ webhook: projectWebhook(unwrapWebhook(data), catalog), ...(include_catalog ? { catalog } : {}) });
    } catch (error) { return upstreamError("Failed to get webhook", error); }
  },
});
