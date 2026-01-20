/**
 * Standardized JSON response builders for MCP tools and resources.
 * Ensures consistent, token-efficient output across all endpoints.
 */

import { ZodError } from "zod";

// Shared rate limiter for write operations
const rateLimiters = new Map<string, number>();

/**
 * Rate limits operations by key. Ensures minimum interval between calls.
 * @param key - Unique identifier for the rate limit bucket (e.g., "post", "topic")
 * @param intervalMs - Minimum interval between operations in milliseconds (default: 1000)
 */
export async function rateLimit(key: string, intervalMs: number = 1000): Promise<void> {
  const now = Date.now();
  const lastOp = rateLimiters.get(key) || 0;
  if (now - lastOp < intervalMs) {
    await new Promise((r) => setTimeout(r, intervalMs - (now - lastOp)));
  }
  rateLimiters.set(key, Date.now());
}

export interface PaginationMeta {
  total?: number;
  page?: number;
  limit?: number;
  has_more?: boolean;
  next_cursor?: string | null;
}

/**
 * Creates a paginated response with a named collection.
 */
export function paginatedResponse<T>(
  collectionName: string,
  items: T[],
  meta: PaginationMeta
): Record<string, unknown> {
  return {
    [collectionName]: items,
    meta: cleanMeta(meta),
  };
}

/**
 * Removes undefined/null values from meta object for compact JSON.
 */
function cleanMeta(meta: PaginationMeta): PaginationMeta {
  const clean: PaginationMeta = {};
  if (meta.total !== undefined) clean.total = meta.total;
  if (meta.page !== undefined) clean.page = meta.page;
  if (meta.limit !== undefined) clean.limit = meta.limit;
  if (meta.has_more !== undefined) clean.has_more = meta.has_more;
  if (meta.next_cursor !== undefined) clean.next_cursor = meta.next_cursor;
  return clean;
}

/**
 * Creates a JSON text response for MCP tools.
 */
export function jsonResponse(data: unknown): { content: Array<{ type: "text"; text: string }> } {
  return {
    content: [{ type: "text", text: JSON.stringify(data) }],
  };
}

/**
 * Creates a JSON error response for MCP tools.
 */
export function jsonError(message: string, details?: Record<string, unknown>): { content: Array<{ type: "text"; text: string }>; isError: true } {
  const error = details ? { error: message, ...details } : { error: message };
  return {
    content: [{ type: "text", text: JSON.stringify(error) }],
    isError: true,
  };
}

/**
 * Creates a JSON error response for Zod validation errors.
 * Formats issues as a readable list of field errors.
 */
export function zodError(error: ZodError): { content: Array<{ type: "text"; text: string }>; isError: true } {
  const issues = error.issues.map(issue => ({
    path: issue.path.join(".") || "(root)",
    message: issue.message,
  }));
  return jsonError("Validation failed", { issues });
}

/**
 * Type guard to check if an error is a ZodError.
 */
export function isZodError(error: unknown): error is ZodError {
  return error instanceof ZodError;
}

/**
 * Category permission types from CategoryGroup model.
 * Used in category `perms` array: [{gid, perm}]
 * - 1 = full (create topics, reply, see)
 * - 2 = create_post (reply, see)
 * - 3 = readonly (see only)
 */

/**
 * Transforms raw Discourse category data to lean migration-ready format.
 */
export interface LeanCategory {
  id: number;
  name: string;
  slug: string;
  pid: number | null;
  read_restricted: boolean;
  topic_count: number;
  post_count: number;
  perms?: Array<{ gid: number; perm: number }>; // Only populated with admin auth
}

export function transformCategory(raw: any): LeanCategory {
  let perms: Array<{ gid: number; perm: number }> | undefined = undefined;
  
  if (Array.isArray(raw.group_permissions) && raw.group_permissions.length > 0) {
    perms = raw.group_permissions.map((gp: any) => ({
      gid: gp.group_id ?? gp.gid ?? 0,
      perm: gp.permission_type ?? gp.perm ?? 1,
    }));
  }
  // Note: Without admin auth, group_permissions is not included in /site.json
  // We intentionally omit perms rather than return misleading gid:0 data

  const result: LeanCategory = {
    id: raw.id,
    name: raw.name,
    slug: raw.slug,
    pid: raw.parent_category_id ?? null,
    read_restricted: raw.read_restricted ?? false,
    topic_count: raw.topic_count ?? 0,
    post_count: raw.post_count ?? 0,
  };
  
  if (perms) {
    result.perms = perms;
  }
  
  return result;
}

/**
 * Transforms raw Discourse group data to lean format.
 * 
 * Visibility/access levels (0-4):
 *   0 = public, 1 = logged_on_users, 2 = members, 3 = staff, 4 = owners
 */
export interface LeanGroup {
  id: number;
  name: string;
  automatic: boolean;
  user_count: number | null;
  vis: number;
  members_vis: number;
  mention: number;
  msg: number;
  public_admission: boolean;
  public_exit: boolean;
  allow_membership_requests: boolean;
}

export function transformGroup(raw: any): LeanGroup {
  return {
    id: raw.id,
    name: raw.name,
    automatic: raw.automatic ?? false,
    user_count: raw.user_count ?? null,
    vis: raw.visibility_level ?? 0,
    members_vis: raw.members_visibility_level ?? 0,
    mention: raw.mentionable_level ?? 0,
    msg: raw.messageable_level ?? 0,
    public_admission: raw.public_admission ?? false,
    public_exit: raw.public_exit ?? false,
    allow_membership_requests: raw.allow_membership_requests ?? false,
  };
}

/**
 * Transforms raw Discourse tag data to lean format.
 * Note: Discourse tags use `name` as the primary identifier (used in filters).
 * The `id` field is the numeric database ID.
 */
export interface LeanTag {
  id: number;
  name: string;
  count: number;
}

export function transformTag(raw: any): LeanTag {
  return {
    id: raw.id ?? 0,
    name: raw.name ?? raw.text ?? String(raw.id),
    count: raw.count ?? raw.topic_count ?? 0,
  };
}

/**
 * Transforms raw Discourse chat channel data to lean format.
 */
export interface LeanChatChannel {
  id: number;
  title: string;
  slug: string;
  status: string;
  members_count: number;
  description: string | null;
}

export function transformChatChannel(raw: any): LeanChatChannel {
  return {
    id: raw.id,
    title: raw.title || `Channel ${raw.id}`,
    slug: raw.slug || String(raw.id),
    status: raw.status || "open",
    members_count: raw.memberships_count ?? raw.members_count ?? 0,
    description: raw.description || null,
  };
}

/**
 * Transforms raw Discourse user chat channel data to lean format.
 * Includes tracking data (unread/mentions).
 */
export interface LeanUserChatChannel {
  id: number;
  title: string;
  slug: string | null;
  status: string;
  unread_count: number;
  mention_count: number;
}

export function transformUserChatChannel(raw: any, tracking?: any): LeanUserChatChannel {
  const channelTracking = tracking?.channel_tracking?.[raw.id] || {};
  return {
    id: raw.id,
    title: raw.title || `Channel ${raw.id}`,
    slug: raw.slug || null,
    status: raw.status || "open",
    unread_count: channelTracking.unread_count ?? 0,
    mention_count: channelTracking.mention_count ?? 0,
  };
}

/**
 * Transforms raw Discourse draft data to lean format.
 */
export interface LeanDraft {
  draft_key: string;
  sequence: number;
  title: string | null;
  category_id: number | null;
  created_at: string | null;
  reply_preview: string | null;
}

export function transformDraft(raw: any): LeanDraft {
  let replyPreview: string | null = null;
  if (raw.data) {
    try {
      const parsed = JSON.parse(raw.data);
      if (parsed.reply) {
        replyPreview = parsed.reply.length > 200 ? parsed.reply.slice(0, 200) + "..." : parsed.reply;
      }
    } catch {
      // Ignore parse errors
    }
  }
  return {
    draft_key: raw.draft_key,
    sequence: raw.sequence ?? 0,
    title: raw.title || null,
    category_id: raw.category_id || null,
    created_at: raw.created_at || null,
    reply_preview: replyPreview,
  };
}
