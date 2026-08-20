import { createHash } from "node:crypto";
import type { SiteState } from "../../../site/state.js";
import type { ToolRegistrationOptions } from "../../types.js";
import { HttpError } from "../../../http/client.js";
import { requireAdminAccess, requireWriteAccess } from "../../../util/access.js";
import { jsonError, withRateLimit } from "../../../util/json_response.js";
import { upstreamError } from "../common/helpers.js";

export const writeAnnotations = (destructive: boolean) => ({ readOnlyHint: false, destructiveHint: destructive, idempotentHint: false, openWorldHint: true } as const);
export function requireAdminRead(siteState: SiteState) { return requireAdminAccess(siteState); }
export function requireAdminWrite(siteState: SiteState, opts: ToolRegistrationOptions) { return requireWriteAccess(siteState, opts.allowWrites) ?? requireAdminAccess(siteState); }
export function webhookMutation<T>(base: string, operation: () => Promise<T>) { return withRateLimit(`webhooks:${base}`, operation); }
export function destinationFingerprint(rawUrl: string) { return createHash("sha256").update(rawUrl).digest("hex"); }
export function webhookMutationError(action: string, error: unknown, attempted: boolean) {
  if (!attempted) return upstreamError(action, error);
  if (error instanceof HttpError) {
    const codes: Record<number, string> = { 400: "invalid_parameters", 401: "authentication_required", 403: "insufficient_permission", 404: "resource_unavailable", 409: "conflict", 422: "invalid_parameters", 429: "rate_limited" };
    return jsonError(`${action}: upstream rejected the request`, { code: codes[error.status] ?? "upstream_error", status: error.status });
  }
  return jsonError(`${action}: the request failed after the mutation was attempted`, { code: "outcome_unknown", outcome_unknown: true, guidance: "Re-read the affected webhook before retrying." });
}
export function precondition(message: string, details: Record<string, unknown> = {}) { return jsonError(message, { code: "precondition_failed", ...details }); }
