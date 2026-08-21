import { z } from "zod";
import { HttpError } from "../../../http/client.js";
import type { SiteState } from "../../../site/state.js";
import type { ToolRegistrationOptions } from "../../types.js";
import { requireAdminAccess, requireAuthenticatedAccess, requireWriteAccess } from "../../../util/access.js";
import { jsonError } from "../../../util/json_response.js";

export const groupIdSchema = z.number().int().positive();
export const groupNameSchema = z.string().trim().min(1).max(100);
export const usernameSchema = z.string().trim().min(1);
export const emailSchema = z.string().trim().email();
export const accessLevelSchema = z.number().int().min(0).max(4);
export const notificationLevelSchema = z.number().int().min(0).max(3);

/** Treat blank strings emitted by some MCP clients for optional fields as omitted. */
export function optionalString<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess(
    (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
    schema.optional(),
  );
}

export function queryString(values: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function requireGroupRead(siteState: SiteState) {
  return requireAuthenticatedAccess(siteState);
}

export function requireGroupWrite(siteState: SiteState, opts: ToolRegistrationOptions) {
  return requireWriteAccess(siteState, opts.allowWrites);
}

export function requireGroupAdminWrite(siteState: SiteState, opts: ToolRegistrationOptions) {
  return requireAdminAccess(siteState) ?? requireWriteAccess(siteState, opts.allowWrites);
}

export function groupError(action: string, error: unknown) {
  if (error instanceof HttpError) {
    const body = error.body as { errors?: unknown; error?: unknown; failed?: unknown } | undefined;
    const details = body?.errors ?? body?.error ?? body?.failed;
    if (details) {
      return jsonError(
        `Failed to ${action}: ${Array.isArray(details) ? details.join("; ") : String(details)}`,
        { status: error.status },
      );
    }
    if (error.status === 404) return jsonError(`Failed to ${action}: group or user not found, not visible, or access denied`, { status: 404 });
    if (error.status === 429) return jsonError(`Failed to ${action}: rate limited; retry later`, { status: 429 });
  }
  return jsonError(`Failed to ${action}: ${error instanceof Error ? error.message : String(error)}`);
}
