import type { SiteState } from "../../../site/state.js";
import type { ToolRegistrationOptions } from "../../types.js";
import { HttpError } from "../../../http/client.js";
import { requireAdminAccess, requireWriteAccess } from "../../../util/access.js";
import { jsonError, withRateLimit } from "../../../util/json_response.js";
import { bounded, upstreamError } from "../common/helpers.js";
import { isBlockedSetting, type SiteSettingDefinition } from "../common/site_setting_values.js";

export function requireAdminRead(siteState: SiteState) { return requireAdminAccess(siteState); }
export function requireAdminWrite(siteState: SiteState, opts: ToolRegistrationOptions) {
  return requireWriteAccess(siteState, opts.allowWrites) ?? requireAdminAccess(siteState);
}
export function siteSettingMutation<T>(base: string, operation: () => Promise<T>) { return withRateLimit(`site-settings:${base}`, operation); }
export function siteSettingMutationError(action: string, error: unknown, attempted: boolean) {
  if (!attempted) return upstreamError(action, error);
  if (error instanceof HttpError) return upstreamError(action, error);
  return jsonError(`${action}: the request failed after the update was attempted`, { code: "outcome_unknown", outcome_unknown: true, guidance: "Re-read the affected site setting before retrying." });
}

function boundedScalar(value: unknown): unknown {
  if (typeof value === "string") return value.slice(0, 1_000);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (value && typeof value === "object") {
    const item = value as Record<string, unknown>; const result: Record<string, unknown> = {};
    for (const key of ["id", "name", "value", "label"]) if (key in item) result[key] = boundedScalar(item[key]);
    return result;
  }
  return String(value ?? "").slice(0, 1_000);
}
function limitedArray(value: unknown, limit = 200) { return Array.isArray(value) ? value.slice(0, limit).map(boundedScalar) : null; }
function limitedRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return Object.fromEntries(Object.entries(value).slice(0, 50).map(([key, child]) => [key.slice(0, 200), Array.isArray(child) ? child.slice(0, 50).map(boundedScalar) : boundedScalar(child)]));
}
export function isSettingOverridden(raw: any): boolean {
  return typeof raw?.overridden === "boolean" ? raw.overridden : String(raw?.value ?? "") !== String(raw?.default ?? "");
}
export function requiresSettingConfirmation(value: unknown): boolean { return value === true || (typeof value === "string" && value.length > 0); }
export function projectSiteSetting(raw: any, descriptionLimit: number): Record<string, unknown> {
  const setting = String(raw?.setting ?? raw?.name ?? "");
  const definition: SiteSettingDefinition = { ...raw, setting };
  const blocked = isBlockedSetting(definition);
  const type = String(raw?.type ?? "string").toLowerCase();
  const blockedType = type === "upload" || type === "uploaded_image_list" || type === "uploaded-image-list" || type === "objects";
  const overridden = isSettingOverridden(raw);
  return {
    setting,
    humanized_name: bounded(raw?.humanized_name, 500),
    description: bounded(raw?.description, Math.min(descriptionLimit, 4_000)),
    category: raw?.category ?? null,
    subcategory: raw?.subcategory ?? raw?.primary_area ?? null,
    plugin: raw?.plugin ?? null,
    type: raw?.type ?? null,
    value: blocked ? null : (raw?.value ?? null),
    default: blocked ? null : (raw?.default ?? null),
    secret: blocked,
    configured: typeof raw?.configured === "boolean" ? raw.configured : raw?.value !== null && raw?.value !== undefined && raw?.value !== "",
    overridden: typeof raw?.overridden === "boolean" ? raw.overridden : overridden,
    valid_values: limitedArray(raw?.valid_values),
    min: typeof raw?.min === "number" ? raw.min : null,
    max: typeof raw?.max === "number" ? raw.max : null,
    mandatory_values: limitedArray(raw?.mandatory_values),
    requires_confirmation: requiresSettingConfirmation(raw?.requires_confirmation),
    requires_confirmation_type: typeof raw?.requires_confirmation === "string" ? raw.requires_confirmation.slice(0, 100) : null,
    depends_on: limitedArray(raw?.depends_on, 50),
    depends_behavior: bounded(raw?.depends_behavior, 100),
    depends_on_values: limitedRecord(raw?.depends_on_values),
    themeable: raw?.themeable === true,
    editable_by_this_tool: !blocked && !blockedType,
    blocked_reason: blocked ? "sensitive_setting_out_of_scope" : blockedType ? "unsupported_setting_type" : null,
  };
}
