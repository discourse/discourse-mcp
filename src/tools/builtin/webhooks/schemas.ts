import { z } from "zod";
const id = z.number().int().positive();
const ids = z.array(id).max(100).refine((v) => new Set(v).size === v.length, "IDs must be unique");
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/);
const url = z.string().url().max(2_048);
const secret = z.string().min(12).max(1_024);

export const listWebhooksSchema = z.object({ offset: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(50).optional(), active: z.boolean().optional(), delivery_status: z.enum(["inactive", "failed", "successful", "disabled"]).optional(), include_catalog: z.boolean().optional() }).strict();
export const getWebhookSchema = z.object({ webhook_id: id, include_catalog: z.boolean().optional() }).strict();
const mutableShape = {
  payload_url: url.optional(), content_type: z.enum(["application/json", "application/x-www-form-urlencoded"]).optional(), secret: z.string().max(1_024).optional(), active: z.boolean().optional(), verify_certificate: z.boolean().optional(), wildcard_web_hook: z.boolean().optional(), event_type_ids: ids.optional(), category_ids: ids.optional(), tag_ids: ids.optional(), group_ids: ids.optional(),
  confirm_activate: z.literal(true).optional(), confirm_wildcard: z.literal(true).optional(), confirm_insecure_http: z.literal(true).optional(), confirm_disable_tls_verification: z.literal(true).optional(),
};
export const createWebhookSchema = z.object({ ...mutableShape, payload_url: url, content_type: z.enum(["application/json", "application/x-www-form-urlencoded"]), secret: secret.optional(), active: z.boolean().optional(), verify_certificate: z.boolean().optional(), wildcard_web_hook: z.boolean().optional(), confirm_external_delivery: z.literal(true) }).strict();
export const updateWebhookSchema = z.object({ ...mutableShape, webhook_id: id, expected_destination_fingerprint: fingerprint, expected_active: z.boolean(), confirm_update: z.literal(true), confirm_scope_replacement: z.literal(true).optional(), confirm_clear_secret: z.literal(true).optional() }).strict();
export const deleteWebhookSchema = z.object({ webhook_id: id, expected_destination_fingerprint: fingerprint, confirm_delete: z.literal(true) }).strict();
export const listWebhookEventsSchema = z.object({ webhook_id: id, status: z.enum(["all", "successful", "failed"]).optional(), offset: z.number().int().min(0).optional(), include_content: z.boolean().optional(), confirm_sensitive_content: z.literal(true).optional(), content_limit: z.number().int().min(100).max(20_000).optional() }).strict();
export const pingWebhookSchema = z.object({ webhook_id: id, expected_destination_fingerprint: fingerprint, confirm_external_request: z.literal(true) }).strict();
export const redeliverWebhookEventSchema = z.object({ webhook_id: id, event_id: id, expected_destination_fingerprint: fingerprint, expected_event_status: z.number().int().min(-1).max(999), confirm_redelivery: z.literal(true) }).strict();
