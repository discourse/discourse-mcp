import { destinationFingerprint } from "./common.js";

const credentialKey = /(?:^|[_-])(?:secret|token|password|passphrase|private[_-]?key|access[_-]?key|api[_-]?key|credentials?|authorization|cookies?)(?:$|[_-])/i;
export function sanitizeWebhookUrl(raw: unknown) {
  if (typeof raw !== "string") return { payload_url: null, payload_url_origin: null, destination_fingerprint: null };
  const fingerprint = destinationFingerprint(raw);
  try {
    const url = new URL(raw);
    url.username = ""; url.password = ""; url.hash = "";
    for (const key of [...url.searchParams.keys()]) url.searchParams.set(key, "[redacted]");
    return { payload_url: url.toString(), payload_url_origin: url.origin, destination_fingerprint: fingerprint };
  } catch {
    return { payload_url: null, payload_url_origin: null, destination_fingerprint: fingerprint };
  }
}
function idList(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.map((item: any) => Number(item?.id ?? item)).filter(Number.isInteger).slice(0, 100);
}
function named(value: any, catalog: Array<{ id: number; name: string }>) {
  const id = Number(value?.id ?? value); const found = catalog.find((item) => item.id === id);
  return { id: Number.isInteger(id) ? id : null, name: found?.name ?? (typeof value?.name === "string" ? value.name.slice(0, 200) : null) };
}
export interface WebhookCatalog { event_types: Array<{ id: number; name: string }>; content_types: Array<{ id: number; name: string }>; delivery_statuses: Array<{ id: number; name: string }> }
function catalogRows(value: unknown): Array<{ id: number; name: string }> {
  const source = Array.isArray(value) ? value : value && typeof value === "object" ? Object.values(value).flatMap((group) => Array.isArray(group) ? group : []) : [];
  return source.map((item: any) => ({ id: Number(item?.id ?? item?.value), name: String(item?.name ?? item?.label ?? item?.value ?? "").slice(0, 200) })).filter((item) => Number.isInteger(item.id) && item.name).filter((item, index, all) => all.findIndex((other) => other.id === item.id) === index).slice(0, 200);
}
export function extractCatalog(data: any): WebhookCatalog {
  const extras = data?.extras ?? data?.meta?.extras ?? {};
  return {
    event_types: catalogRows(extras.grouped_event_types ?? extras.web_hook_event_types ?? extras.event_types ?? extras.default_event_types),
    content_types: catalogRows(extras.content_types ?? extras.web_hook_content_types),
    delivery_statuses: catalogRows(extras.delivery_statuses ?? extras.web_hook_delivery_statuses),
  };
}
export function unwrapWebhook(data: any): any { return data?.web_hook ?? data?.webhook ?? data; }
export function webhookRows(data: any): any[] { const rows = data?.web_hooks ?? data?.webhooks; return Array.isArray(rows) ? rows : []; }
export function projectWebhook(raw: any, catalog: WebhookCatalog) {
  const url = sanitizeWebhookUrl(raw?.payload_url);
  const rawEvents = raw?.web_hook_event_types ?? raw?.event_types ?? raw?.web_hook_event_type_ids ?? [];
  const events = Array.isArray(rawEvents) ? rawEvents.map((item: any) => named(item, catalog.event_types)).filter((item) => item.id !== null).slice(0, 100) : [];
  return {
    id: Number.isInteger(Number(raw?.id)) ? Number(raw.id) : null, ...url,
    content_type: named(raw?.content_type, catalog.content_types),
    last_delivery_status: named(raw?.last_delivery_status, catalog.delivery_statuses),
    active: raw?.active === true, wildcard_web_hook: raw?.wildcard_web_hook === true, verify_certificate: raw?.verify_certificate !== false,
    secret_configured: typeof raw?.secret === "string" ? raw.secret.length > 0 : raw?.secret_configured === true,
    category_ids: idList(raw?.category_ids ?? raw?.categories), tag_ids: idList(raw?.tag_ids ?? raw?.tags), group_ids: idList(raw?.group_ids ?? raw?.groups), event_types: events,
  };
}
function redactObject(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => redactObject(item, depth + 1));
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value).slice(0, 100)) result[key.slice(0, 200)] = credentialKey.test(key) ? "[redacted]" : redactObject(child, depth + 1);
    return result;
  }
  if (typeof value === "string") return redactText(value);
  return value;
}
function redactText(value: unknown): string {
  return String(value ?? "")
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/gi, "$1[redacted]@")
    .replace(/(^|\n)(authorization|cookie|set-cookie|x-api-key)\s*:[^\n]*/gi, "$1$2: [redacted]")
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gi, "[redacted private key]");
}
function contentPreview(value: unknown, limit: number) {
  let redacted: string;
  if (typeof value === "string") {
    try { redacted = JSON.stringify(redactObject(JSON.parse(value))); } catch { redacted = redactText(value); }
  } else redacted = JSON.stringify(redactObject(value));
  return { preview: redacted.slice(0, limit), truncated: redacted.length > limit };
}
function headerObject(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") { try { const parsed = JSON.parse(value); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null; } catch { return null; } }
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function headerNames(value: unknown): string[] {
  const headers = headerObject(value); if (!headers) return [];
  return Object.keys(headers).map((key) => key.toLowerCase().slice(0, 100)).slice(0, 100);
}
function contentType(value: unknown): string | null {
  const headers = headerObject(value); if (!headers) return null;
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === "content-type")?.[1];
  return typeof entry === "string" ? entry.slice(0, 200) : null;
}
export function projectWebhookEvent(raw: any, includeContent: boolean, limit: number) {
  const payload = includeContent ? contentPreview(raw?.payload, limit) : null;
  const response = includeContent ? contentPreview(raw?.response_body, limit) : null;
  return {
    id: Number(raw?.id) || null, webhook_id: Number(raw?.web_hook_id ?? raw?.webhook_id) || null,
    status: Number.isInteger(Number(raw?.status)) ? Number(raw.status) : null,
    duration_ms: Number.isFinite(Number(raw?.duration)) ? Number(raw.duration) : null,
    created_at: typeof raw?.created_at === "string" ? raw.created_at.slice(0, 100) : null,
    redelivering: raw?.redelivering === true,
    request_destination: sanitizeWebhookUrl(raw?.request_url ?? raw?.url ?? raw?.payload_url).payload_url,
    request_header_names: headerNames(raw?.headers ?? raw?.request_headers), response_header_names: headerNames(raw?.response_headers),
    content_type: contentType(raw?.headers ?? raw?.request_headers),
    content_included: includeContent, content_truncated: Boolean(payload?.truncated || response?.truncated), content_may_contain_private_forum_data: includeContent,
    ...(includeContent ? { request_payload_preview: payload?.preview, response_body_preview: response?.preview } : {}),
  };
}
