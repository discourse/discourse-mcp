import { LIMITS, type ThemeFieldInput } from "./schemas.js";

type JsonRecord = Record<string, unknown>;
const SECRET_KEY = /(?:private[_-]?key|secret|password|token|authorization|api[_-]?key|public_key)/i;

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function valueOrNull(value: unknown): unknown { return value === undefined ? null : value; }
function boolOrNull(value: unknown): boolean | null { return typeof value === "boolean" ? value : null; }
function numberOrNull(value: unknown): number | null { return typeof value === "number" && Number.isFinite(value) ? value : null; }

interface TruncationState { truncated: boolean; omitted_characters: number; included_characters: number; }

function safeString(value: unknown, limit: number, state: TruncationState): string | null {
  if (value === undefined || value === null) return null;
  let text = String(value)
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/gi, "$1[redacted]@")
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gi, "[redacted private key]");
  // Redact URL userinfo while retaining a useful repository identity.
  try {
    const url = new URL(text);
    if (url.username || url.password) {
      url.username = "[redacted]";
      url.password = "";
      text = url.toString();
    }
  } catch { /* not a URL */ }
  const remaining = Math.max(0, LIMITS.outputAggregate - state.included_characters);
  const allowed = Math.min(limit, remaining);
  if (text.length > allowed) {
    state.truncated = true;
    state.omitted_characters += text.length - allowed;
    text = text.slice(0, allowed);
  }
  state.included_characters += text.length;
  return text;
}

function sanitize(value: unknown, state: TruncationState, depth = 0): unknown {
  if (depth > 8) return null;
  if (typeof value === "string") return safeString(value, LIMITS.outputText, state);
  if (Array.isArray(value)) return value.slice(0, 500).map((v) => sanitize(v, state, depth + 1));
  const source = record(value);
  if (!source) return valueOrNull(value);
  const result: JsonRecord = {};
  for (const [key, child] of Object.entries(source).slice(0, 500)) {
    if (SECRET_KEY.test(key)) continue;
    result[key] = sanitize(child, state, depth + 1);
  }
  return result;
}

export function unwrapTheme(payload: unknown): JsonRecord {
  const source = record(payload);
  return record(source?.theme) ?? source ?? {};
}

function relationSummary(value: unknown): Array<{ id: unknown; name: string | null }> {
  const state = { truncated: false, omitted_characters: 0, included_characters: 0 };
  return array(value).slice(0, 200).map((item) => {
    const row = record(item) ?? {};
    return { id: valueOrNull(row.id), name: safeString(row.name, 500, state) };
  });
}

function remoteProjection(theme: JsonRecord, state: TruncationState): JsonRecord | null {
  const remote = record(theme.remote_theme);
  if (!remote && theme.remote_theme_id === undefined) return null;
  const source = remote ?? {};
  return {
    id: valueOrNull(source.id ?? theme.remote_theme_id),
    url: safeString(source.remote_url, LIMITS.url, state),
    branch: safeString(source.branch, LIMITS.branch, state),
    local_version: safeString(source.local_version, 500, state),
    remote_version: safeString(source.remote_version, 500, state),
    commits_behind: numberOrNull(source.commits_behind),
    local_compat_ref: safeString(source.local_compat_ref, 500, state),
    remote_compat_ref: safeString(source.remote_compat_ref, 500, state),
    remote_updated_at: valueOrNull(source.remote_updated_at),
    updated_at: valueOrNull(source.updated_at),
    last_error: safeString(source.last_error_text, LIMITS.outputText, state),
    is_git: boolOrNull(source["is_git?"] ?? source.is_git),
    update_available: typeof source.commits_behind === "number" ? source.commits_behind > 0 : null,
    auto_update: boolOrNull(theme.auto_update),
    theme_version: safeString(source.theme_version, 500, state),
    minimum_discourse_version: safeString(source.minimum_discourse_version, 500, state),
    maximum_discourse_version: safeString(source.maximum_discourse_version, 500, state),
  };
}

function errorCount(theme: JsonRecord): number {
  let count = array(theme.errors).filter(Boolean).length;
  for (const field of array(theme.theme_fields)) if (record(field)?.error) count++;
  if (record(theme.remote_theme)?.last_error_text) count++;
  return count;
}

export function slimTheme(payload: unknown): JsonRecord {
  const theme = unwrapTheme(payload);
  const state = { truncated: false, omitted_characters: 0, included_characters: 0 };
  return {
    id: valueOrNull(theme.id),
    name: safeString(theme.name, 500, state),
    component: boolOrNull(theme.component),
    system: boolOrNull(theme.system),
    default: boolOrNull(theme.default),
    user_selectable: boolOrNull(theme.user_selectable),
    enabled: boolOrNull(theme["enabled?"] ?? theme.enabled),
    supported: boolOrNull(theme["supported?"] ?? theme.supported),
    auto_update: boolOrNull(theme.auto_update),
    parents: relationSummary(theme.parent_themes),
    children: relationSummary(theme.child_themes),
    remote: remoteProjection(theme, state),
    error_count: errorCount(theme),
  };
}

export function detailedTheme(payload: unknown, includeFieldValues = false): JsonRecord {
  const theme = unwrapTheme(payload);
  const state = { truncated: false, omitted_characters: 0, included_characters: 0 };
  const remote = remoteProjection(theme, state);
  const hasRemote = theme.remote_theme_id !== undefined && theme.remote_theme_id !== null;
  const isGit = record(theme.remote_theme)?.["is_git?"] ?? record(theme.remote_theme)?.is_git;
  const fields = array(theme.theme_fields).slice(0, 500).map((item) => {
    const field = record(item) ?? {};
    const projected: JsonRecord = {
      name: safeString(field.name, 500, state),
      target: safeString(field.target, 100, state),
      type_id: numberOrNull(field.type_id),
      path: safeString(field.file_path, 2000, state),
      upload_id: valueOrNull(field.upload_id),
      upload_url: safeString(field.url, 4000, state),
      filename: safeString(field.filename, 500, state),
      migrated: boolOrNull(field.migrated),
      error: safeString(field.error, LIMITS.outputText, state),
    };
    if (includeFieldValues && Object.prototype.hasOwnProperty.call(field, "value")) {
      projected.value = safeString(field.value, LIMITS.outputText, state);
    }
    return projected;
  });
  const errors = array(theme.errors).map((e) => safeString(e, LIMITS.outputText, state)).filter((e) => e !== null);
  const result: JsonRecord = {
    id: valueOrNull(theme.id),
    name: safeString(theme.name, 500, state),
    component: boolOrNull(theme.component),
    system: boolOrNull(theme.system),
    default: boolOrNull(theme.default),
    user_selectable: boolOrNull(theme.user_selectable),
    enabled: boolOrNull(theme["enabled?"] ?? theme.enabled),
    supported: boolOrNull(theme["supported?"] ?? theme.supported),
    auto_update: boolOrNull(theme.auto_update),
    color_scheme_id: valueOrNull(theme.color_scheme_id),
    dark_color_scheme_id: valueOrNull(theme.dark_color_scheme_id),
    color_scheme: sanitize(theme.color_scheme, state),
    only_theme_color_schemes: valueOrNull(theme.only_theme_color_schemes),
    creator: sanitize(theme.user, state),
    created_at: valueOrNull(theme.created_at),
    updated_at: valueOrNull(theme.updated_at),
    disabled_at: valueOrNull(theme.disabled_at),
    disabled_by: sanitize(theme.disabled_by, state),
    parents: relationSummary(theme.parent_themes),
    children: relationSummary(theme.child_themes),
    remote,
    source_kind: !hasRemote ? "local" : isGit === true ? "repository" : isGit === false ? "archive" : "remote_unknown",
    field_values_available: !hasRemote,
    fields_directly_editable: theme.system === true ? false : isGit === true ? false : true,
    settings: sanitize(theme.settings, state),
    themeable_site_settings: sanitize(theme.themeable_site_settings, state),
    translations: sanitize(theme.translations, state),
    fields,
    errors,
    healthy: errors.length === 0 && !fields.some((field) => field.error) && !record(remote)?.last_error,
    truncation: { truncated: state.truncated, omitted_characters: state.omitted_characters, included_characters: state.included_characters, per_value_limit: LIMITS.outputText, aggregate_limit: LIMITS.outputAggregate },
  };
  return result;
}

const TYPE_IDS = {
  html: 0, scss: 1, upload: 2, yaml: 5, javascript: 6, json: 8,
} as const;

export function fieldPayload(field: ThemeFieldInput): JsonRecord {
  const result: JsonRecord = { name: field.name, target: field.target };
  if (field.operation === "delete") {
    result.value = ""; // Explicit operation makes upstream blank-value deletion deliberate.
    return result;
  }
  if ("value" in field) result.value = field.value;
  if ("upload_id" in field) result.upload_id = field.upload_id;
  if ("type" in field && field.type) result.type_id = TYPE_IDS[field.type];
  return result;
}

export function summariesEqual(left: unknown, right: unknown): boolean | null {
  if (left === undefined || right === undefined || left === null || right === null) return null;
  return JSON.stringify(left) === JSON.stringify(right);
}
