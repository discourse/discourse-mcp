import { z } from "zod";
import { HttpError } from "../../../http/client.js";
import type { SiteState } from "../../../site/state.js";
import { requireAdminAccess, requireWriteAccess } from "../../../util/access.js";
import { jsonError } from "../../../util/json_response.js";
import type { ToolRegistrationOptions } from "../../types.js";

export const AI_AGENTS_BASE = "/admin/plugins/discourse-ai/ai-agents";
export const AI_TOOLS_BASE = "/admin/plugins/discourse-ai/ai-tools";
export const AI_FEATURES_BASE = "/admin/plugins/discourse-ai/ai-features";

export const aiIdSchema = z.union([
  z.number().int().positive(),
  z.string().regex(/^\d+$/, "ID must be numeric"),
]);

export function requireAiAdmin(siteState: SiteState) {
  return requireAdminAccess(siteState);
}

export function requireAiAdminWrite(siteState: SiteState, opts: ToolRegistrationOptions) {
  return requireAdminAccess(siteState) ?? requireWriteAccess(siteState, opts.allowWrites);
}

export function aiAdminError(action: string, error: unknown) {
  if (error instanceof HttpError) {
    const body = error.body as { errors?: unknown; error?: unknown } | undefined;
    const details = body?.errors ?? body?.error;
    if (details) {
      const message = Array.isArray(details)
        ? details.map((detail) => typeof detail === "string" ? detail : JSON.stringify(detail)).join("; ")
        : typeof details === "string" ? details : JSON.stringify(details);
      return jsonError(`Failed to ${action}: ${message}`, { status: error.status });
    }
    if (error.status === 401 || error.status === 403) {
      return jsonError(`Failed to ${action}: selected credentials are not authorized for this admin operation`, { status: error.status });
    }
    if (error.status === 404) {
      return jsonError(`Failed to ${action}: item not found, Discourse AI is unavailable, or the API key is not authorized`, { status: 404 });
    }
    if (error.status === 429) return jsonError(`Failed to ${action}: rate limited; retry later`, { status: 429 });
  }
  return jsonError(`Failed to ${action}: ${error instanceof Error ? error.message : String(error)}`);
}

export function stripSecretBindings(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSecretBindings);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== "secret_bindings")
      .map(([key, nested]) => [key, stripSecretBindings(nested)]),
  );
}

export function deleteSuccess(kind: "agent" | "custom_tool", id: string | number) {
  return { success: true, deleted: true, kind, id };
}
