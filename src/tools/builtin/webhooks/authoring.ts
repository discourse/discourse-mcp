import type { HttpClient } from "../../../http/client.js";
import { jsonError } from "../../../util/json_response.js";
import { extractCatalog, unwrapWebhook, type WebhookCatalog } from "./projections.js";

export async function fetchCatalog(client: HttpClient) {
  const data = await client.get("/admin/api/web_hooks.json?offset=0");
  return extractCatalog(data);
}
export function validateDestination(raw: string, confirmInsecure?: true): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "Only HTTP(S) webhook destinations are supported";
    if (url.username || url.password) return "Webhook URLs must not contain userinfo credentials";
    if (url.protocol === "http:" && confirmInsecure !== true) return "HTTP destinations require confirm_insecure_http=true";
    return null;
  } catch { return "Webhook destination is malformed"; }
}
export function contentTypeId(catalog: WebhookCatalog, name: string): number | null { return catalog.content_types.find((item) => item.name === name)?.id ?? null; }
export function validateEvents(catalog: WebhookCatalog, ids: number[]) { const known = new Set(catalog.event_types.map((item) => item.id)); return ids.filter((id) => !known.has(id)); }
export function validateSubscription(input: { wildcard_web_hook?: boolean; event_type_ids?: number[]; confirm_wildcard?: true }) {
  if (input.wildcard_web_hook === true) {
    if (input.confirm_wildcard !== true) return jsonError("Wildcard subscriptions require confirm_wildcard=true", { code: "confirmation_required" });
    if ((input.event_type_ids?.length ?? 0) > 0) return jsonError("Wildcard and explicit event subscriptions cannot be combined", { code: "invalid_parameters" });
  } else if (!input.event_type_ids?.length) return jsonError("A non-wildcard webhook requires at least one event type", { code: "invalid_parameters" });
  return null;
}
export function webhookFromResponse(data: any) { return unwrapWebhook(data); }
