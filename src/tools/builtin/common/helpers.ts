import { HttpError } from "../../../http/client.js";
import { jsonError } from "../../../util/json_response.js";

export function bounded(value: unknown, limit: number): string | null {
  if (value === undefined || value === null) return null;
  return String(value).slice(0, Math.max(0, limit));
}

export function queryString(values: Record<string, unknown>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      for (const item of value) query.append(`${key}[]`, String(item));
    } else {
      query.set(key, String(value));
    }
  }
  const encoded = query.toString();
  return encoded ? `?${encoded}` : "";
}

export function upstreamError(action: string, error: unknown) {
  if (error instanceof HttpError) {
    const codes: Record<number, string> = {
      400: "invalid_parameters",
      401: "authentication_required",
      403: "insufficient_permission",
      404: "resource_unavailable",
      409: "conflict",
      422: "invalid_parameters",
      429: "rate_limited",
    };
    const details: Record<string, unknown> = {
      code: codes[error.status] ?? "upstream_error",
      status: error.status,
    };
    if (error.status === 429) {
      const serialized = typeof error.body === "string" ? error.body : JSON.stringify(error.body ?? "");
      const match = serialized.match(/(?:wait|retry(?: after)?)[^0-9]{0,20}(\d+)\s*(?:seconds?|secs?)/i);
      if (match) details.retry_after_seconds = Number(match[1]);
      details.retryable = true;
    }
    return jsonError(`${action}: ${error.message}`, details);
  }
  return jsonError(`${action}: ${error instanceof Error ? error.message : String(error)}`, {
    code: "request_failed",
  });
}

export function mutationError(action: string, error: unknown) {
  if (error instanceof HttpError) {
    const body = error.body as any;
    const upstreamErrors = Array.isArray(body?.errors)
      ? body.errors.filter((item: unknown) => typeof item === "string").slice(0, 20)
      : undefined;
    const details: Record<string, unknown> = {
      code: error.status === 400 || error.status === 422 ? "invalid_parameters" : "upstream_error",
      status: error.status,
    };
    if (upstreamErrors?.length) details.errors = upstreamErrors;
    if (typeof body?.error_type === "string") details.error_type = body.error_type;
    return jsonError(`${action}: ${error.message}`, details);
  }
  return upstreamError(action, error);
}

export function pluginError(action: string, plugin: string, error: unknown) {
  if (error instanceof HttpError && error.status === 404) {
    return jsonError(`${action}: capability or resource unavailable`, {
      code: "capability_or_resource_unavailable",
      status: 404,
      required_plugin: plugin,
      possible_causes: ["plugin or site feature is disabled", "resource is hidden", "resource does not exist"],
    });
  }
  return upstreamError(action, error);
}

export function readAnnotations() {
  return { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;
}
