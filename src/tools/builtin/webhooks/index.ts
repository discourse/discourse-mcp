import type { ToolDefinition } from "../../definition.js";
import { listWebhooksTool } from "./list_webhooks.js";
import { getWebhookTool } from "./get_webhook.js";
import { createWebhookTool } from "./create_webhook.js";
import { updateWebhookTool } from "./update_webhook.js";
import { deleteWebhookTool } from "./delete_webhook.js";
import { listWebhookEventsTool } from "./list_webhook_events.js";
import { pingWebhookTool } from "./ping_webhook.js";
import { redeliverWebhookEventTool } from "./redeliver_webhook_event.js";

export const webhookTools = [listWebhooksTool, getWebhookTool, createWebhookTool, updateWebhookTool, deleteWebhookTool, listWebhookEventsTool, pingWebhookTool, redeliverWebhookEventTool] as const satisfies readonly ToolDefinition[];
export { listWebhooksTool, getWebhookTool, createWebhookTool, updateWebhookTool, deleteWebhookTool, listWebhookEventsTool, pingWebhookTool, redeliverWebhookEventTool };
