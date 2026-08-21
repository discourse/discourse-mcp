import type { SiteState } from "../../../site/state.js";
import type { ToolRegistrationOptions } from "../../types.js";
import { requireAdminAccess, requireWriteAccess } from "../../../util/access.js";
import { jsonError, withRateLimit } from "../../../util/json_response.js";
import { HttpError } from "../../../http/client.js";
import { upstreamError } from "../common/helpers.js";

export const writeAnnotations = (destructive: boolean, idempotent: boolean) => ({
  readOnlyHint: false,
  destructiveHint: destructive,
  idempotentHint: idempotent,
  openWorldHint: true,
} as const);

export function requireThemeRead(siteState: SiteState) {
  return requireAdminAccess(siteState);
}

export function requireThemeWrite(siteState: SiteState, opts: ToolRegistrationOptions) {
  return requireWriteAccess(siteState, opts.allowWrites) ?? requireAdminAccess(siteState);
}

export function themeMutation<T>(base: string, operation: () => Promise<T>): Promise<T> {
  return withRateLimit(`themes:${base}`, operation);
}

export function validateRepositoryUrl(raw: string): string | null {
  if ([...raw].some((char) => { const code = char.charCodeAt(0); return code <= 31 || code === 127; })) return "Repository URL must not contain control characters";
  const value = raw.trim();
  if (!value) return "Repository URL must not be empty";
  // Discourse accepts ordinary HTTPS and SSH/scp-like Git URLs. Explicitly reject
  // local/file and uncommon schemes while leaving the site allowlist authoritative.
  if (/^[^@\s]+@[^:\s]+:.+$/.test(value)) return null;
  const scheme = value.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase();
  if (!scheme || !["http", "https", "ssh", "git"].includes(scheme)) {
    return scheme ? `Unsupported repository URL scheme: ${scheme}` : "Repository URL must be an HTTP(S), SSH, Git, or scp-like URL";
  }
  try {
    const parsed = new URL(value);
    if (!parsed.hostname) return "Repository URL must include a host";
    if (parsed.password) return "Repository URLs must not embed credentials";
  } catch {
    return "Repository URL is malformed";
  }
  return null;
}

export function themeReadError(action: string, error: unknown) {
  return upstreamError(action, error);
}

export function themeMutationError(action: string, error: unknown, attempted = true) {
  if (error instanceof HttpError) {
    const body = error.body as Record<string, unknown> | null;
    const codes: Record<number, string> = { 400: "invalid_parameters", 401: "authentication_required", 403: "insufficient_permission", 404: "resource_unavailable", 409: "conflict", 422: "invalid_parameters", 429: "rate_limited" };
    const redact = (value: string) => value
      .replace(/([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/gi, "$1[redacted]@")
      .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gi, "[redacted private key]")
      .slice(0, 4_000);
    const details: Record<string, unknown> = { code: codes[error.status] ?? "upstream_error", status: error.status };
    if (Array.isArray(body?.errors)) details.errors = body.errors.filter((item): item is string => typeof item === "string").slice(0, 20).map(redact);
    if (typeof body?.error_type === "string") details.error_type = redact(body.error_type);
    return jsonError(`${action}: ${error.message}`, details);
  }
  if (attempted) {
    return jsonError(`${action}: ${error instanceof Error ? error.message : String(error)}`, {
      code: "outcome_unknown",
      outcome_unknown: true,
      guidance: "Inspect current theme state with discourse_list_themes or discourse_get_theme before retrying.",
    });
  }
  return upstreamError(action, error);
}

export function precondition(message: string, details: Record<string, unknown> = {}) {
  return jsonError(message, { code: "precondition_failed", ...details });
}

export function componentFlag(theme: Record<string, unknown>): boolean | null {
  return typeof theme.component === "boolean" ? theme.component : null;
}
