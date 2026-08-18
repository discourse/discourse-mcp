import { HttpError } from "../../../http/client.js";
import { jsonError, withRateLimit } from "../../../util/json_response.js";
import { projectTopic } from "../filter_topics.js";

const CONTENT_LIMIT = 4_000;
const REVIEWABLE_STATUSES: Record<number, string> = {
  0: "pending",
  1: "approved",
  2: "rejected",
  3: "ignored",
  4: "deleted",
};
const REVIEWABLE_PRIORITIES: Record<number, string> = {
  0: "low",
  5: "medium",
  10: "high",
};

/** Pace moderation reads from concurrent model tool batches on a per-site queue. */
export function moderationRead<T>(base: string, operation: () => Promise<T>): Promise<T> {
  return withRateLimit(`discourse-api:${base}`, operation, 200);
}

function bounded(value: unknown): unknown {
  if (typeof value !== "string") return value ?? null;
  return value.length > CONTENT_LIMIT ? `${value.slice(0, CONTENT_LIMIT)}…` : value;
}

function boundedRecord(record: unknown): Record<string, unknown> | null {
  if (!record || typeof record !== "object" || Array.isArray(record)) return null;
  return Object.fromEntries(Object.entries(record as Record<string, unknown>).map(([key, item]) => [
    key,
    Array.isArray(item) ? item.slice(0, 100).map(bounded) : bounded(item),
  ]));
}

function value(source: any, ...keys: string[]): unknown {
  for (const key of keys) if (source?.[key] !== undefined) return source[key];
  return null;
}

export function normalizeAction(action: any) {
  return {
    id: value(action, "id", "action_id"),
    label: value(action, "label", "name", "title"),
    icon: value(action, "icon"),
    button_class: value(action, "button_class"),
    confirm_message: value(action, "confirm_message", "confirm"),
    confirm_destructive: value(action, "confirm_destructive"),
    description: value(action, "description"),
    completed_message: value(action, "completed_message"),
    server_action: value(action, "server_action"),
    client_action: value(action, "client_action"),
    require_reject_reason: value(action, "require_reject_reason"),
    additional_fields: action?.additional_fields ?? action?.fields ?? [],
  };
}

export function availableActions(reviewable: any, root?: any): any[] {
  const rootActions = Array.isArray(root?.actions) ? root.actions : [];
  const resolveAction = (candidate: any) => {
    if (candidate && typeof candidate === "object") return candidate;
    return rootActions.find((action: any) => String(action?.id) === String(candidate)) ?? { id: candidate };
  };
  const rootBundles = Array.isArray(root?.bundled_actions) ? root.bundled_actions : [];
  const resolveBundle = (candidate: any) => {
    if (candidate && typeof candidate === "object") return candidate;
    return rootBundles.find((bundle: any) => String(bundle?.id) === String(candidate));
  };
  const candidates: any[] = [];
  const direct = reviewable?.available_actions ?? reviewable?.actions ?? reviewable?.action_ids;
  if (Array.isArray(direct)) candidates.push(...direct.map(resolveAction));
  const bundleRefs = reviewable?.bundled_actions ?? reviewable?.bundled_action_ids;
  if (Array.isArray(bundleRefs)) {
    for (const reference of bundleRefs) {
      const bundle = resolveBundle(reference);
      const bundleActions = bundle?.actions ?? bundle?.action_ids;
      if (Array.isArray(bundleActions)) candidates.push(...bundleActions.map(resolveAction));
    }
  }
  if (candidates.length === 0 && Array.isArray(root?.reviewable_actions)) {
    candidates.push(...root.reviewable_actions.filter((action: any) =>
      action?.reviewable_id === undefined || String(action.reviewable_id) === String(reviewable?.id),
    ));
  }
  return [...new Map(candidates.map((action) => [String(action?.id ?? action?.action_id), action])).values()].map(normalizeAction);
}

export function allowedActionFieldNames(action: any): Set<string> {
  const fields = action?.additional_fields ?? action?.fields;
  const names = new Set<string>();
  if (Array.isArray(fields)) {
    for (const field of fields) {
      if (typeof field === "string") names.add(field);
      else if (field && typeof field === "object") {
        const name = field.name ?? field.id ?? field.key;
        if (typeof name === "string") names.add(name);
      }
    }
  } else if (fields && typeof fields === "object") {
    for (const name of Object.keys(fields)) names.add(name);
  }
  return names;
}

export function normalizeReviewable(reviewable: any, root?: any) {
  const rawStatus = value(reviewable, "status", "status_name");
  const rawPriority = value(reviewable, "priority", "priority_name");
  const scoreRefs = reviewable?.reviewable_scores ?? reviewable?.reviewable_score_ids ?? reviewable?.scores;
  const rootScores = Array.isArray(root?.reviewable_scores) ? root.reviewable_scores : [];
  const scores = Array.isArray(scoreRefs)
    ? scoreRefs.map((score: any) => score && typeof score === "object"
        ? score
        : rootScores.find((candidate: any) => String(candidate?.id) === String(score))).filter(Boolean)
    : rootScores.filter((score: any) => String(score?.reviewable_id) === String(reviewable?.id));
  return {
    id: value(reviewable, "id"),
    type: value(reviewable, "type", "reviewable_type"),
    status: typeof rawStatus === "number" ? (REVIEWABLE_STATUSES[rawStatus] ?? "unknown") : rawStatus,
    status_id: typeof rawStatus === "number" ? rawStatus : null,
    priority: typeof rawPriority === "number" ? (REVIEWABLE_PRIORITIES[rawPriority] ?? "unknown") : rawPriority,
    priority_id: typeof rawPriority === "number" ? rawPriority : null,
    score: value(reviewable, "score"),
    created_at: value(reviewable, "created_at"),
    updated_at: value(reviewable, "updated_at"),
    topic_id: value(reviewable, "topic_id", "target_topic_id"),
    topic: reviewable?.topic && typeof reviewable.topic === "object" ? projectTopic(reviewable.topic) : null,
    category_id: value(reviewable, "category_id"),
    post_id: value(reviewable, "post_id", "target_post_id"),
    target_user_id: value(reviewable, "target_user_id", "user_id"),
    created_by_id: value(reviewable, "created_by_id"),
    target_created_by_id: value(reviewable, "target_created_by_id"),
    target_id: value(reviewable, "target_id"),
    target_type: value(reviewable, "target_type"),
    target_url: value(reviewable, "target_url"),
    target_created_at: value(reviewable, "target_created_at"),
    raw: bounded(reviewable?.raw ?? reviewable?.payload?.raw ?? null),
    excerpt: bounded(reviewable?.excerpt ?? reviewable?.cooked ?? null),
    payload: boundedRecord(reviewable?.payload),
    claimed_by_id: value(reviewable, "claimed_by_id"),
    claimed_by: reviewable?.claimed_by ?? null,
    version: value(reviewable, "version"),
    editable_fields: reviewable?.editable_fields ?? [],
    scores,
    available_actions: availableActions(reviewable, root),
  };
}

function slimUser(user: any) {
  return {
    id: value(user, "id"),
    username: value(user, "username"),
    name: value(user, "name"),
    avatar_template: value(user, "avatar_template"),
  };
}

function slimCategory(category: any) {
  return {
    id: value(category, "id"),
    name: value(category, "name"),
    slug: value(category, "slug"),
    color: value(category, "color"),
  };
}

export function normalizeSideLoads(data: any) {
  return {
    users: Array.isArray(data?.users) ? data.users.map(slimUser) : [],
    topics: Array.isArray(data?.topics) ? data.topics.map(projectTopic) : [],
    categories: Array.isArray(data?.categories) ? data.categories.map(slimCategory) : [],
  };
}

export function normalizeReviewContext(data: any) {
  const rawReviewable = data?.reviewable ?? (Array.isArray(data?.reviewables) ? data.reviewables[0] : data);
  return {
    reviewable: normalizeReviewable(rawReviewable, data),
    ...normalizeSideLoads(data),
  };
}

function errorDetails(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const record = body as Record<string, unknown>;
  const details = record.errors ?? record.error;
  if (Array.isArray(details)) return details.map(String).join("; ");
  if (typeof details === "string" || typeof details === "number") return String(details);
  return undefined;
}

interface ModerationErrorContext {
  reviewable_id?: number;
  action_id?: string;
  performed_action?: string;
  mutation_attempted?: boolean;
}

export function moderationError(action: string, error: unknown, context: ModerationErrorContext = {}) {
  if (error instanceof HttpError) {
    const detail = errorDetails(error.body);
    const labels: Record<number, string> = {
      400: "invalid review queue filters or parameters",
      401: "authentication required",
      403: "not permitted to access this reviewable",
      404: context.mutation_attempted
        ? "the action request returned not found after preflight; the outcome is unknown and must be verified before retrying"
        : "reviewable not found, not visible, or already removed",
      409: "reviewable version or claim conflict; refresh and retry",
      422: "invalid or unavailable reviewable action or fields",
      429: "rate limited; wait before retrying",
    };
    const message = detail ?? labels[error.status] ?? error.message;
    const details: Record<string, unknown> = { status: error.status, ...context };
    if (error.status === 404 && context.mutation_attempted) {
      details.outcome = "unknown";
      details.retryable = false;
    }
    if (error.status === 429) {
      details.retryable = true;
      const seconds = message.match(/wait(?:\s+for)?\s+(\d+)\s+seconds?/i)?.[1];
      if (seconds) details.retry_after_seconds = Number(seconds);
    }
    return jsonError(`Failed to ${action}: ${message}`, details);
  }
  return jsonError(`Failed to ${action}: ${error instanceof Error ? error.message : String(error)}`, { ...context });
}
