import { z } from "zod";
import { defineTool } from "../../definition.js";
import { jsonResponse, withRateLimit } from "../../../util/json_response.js";
import { bounded, queryString, readAnnotations, upstreamError } from "../common/helpers.js";

export const USER_ACTION_TYPES = {
  likes: 1,
  was_liked: 2,
  topics: 4,
  replies: 5,
  responses: 6,
  mentions: 7,
  quotes: 9,
  edits: 11,
  private_messages_sent: 12,
  private_messages_received: 13,
  solved: 15,
  assigned: 16,
  linked: 17,
} as const;
export type UserActionName = keyof typeof USER_ACTION_TYPES;
const actionNamesById = new Map<number, string>(Object.entries(USER_ACTION_TYPES).map(([name, id]) => [id, name]));
const actionName = z.enum(Object.keys(USER_ACTION_TYPES) as [UserActionName, ...UserActionName[]]);

const schema = z.object({
  username: z.string().min(1),
  acting_username: z.string().min(1).optional(),
  action_types: z.array(actionName).min(1).optional(),
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

export function projectUserAction(action: any, maxReadLength: number) {
  return {
    action_type: actionNamesById.get(action?.action_type) ?? "unknown",
    action_type_id: action?.action_type ?? null,
    id: action?.id ?? null,
    post_id: action?.post_id ?? action?.id ?? null,
    topic_id: action?.topic_id ?? null,
    post_number: action?.post_number ?? null,
    username: action?.username ?? null,
    acting_username: action?.acting_username ?? null,
    target_username: action?.target_username ?? null,
    slug: action?.slug ?? null,
    title: action?.title ?? null,
    category_id: action?.category_id ?? null,
    created_at: action?.created_at ?? null,
    excerpt: bounded(action?.excerpt, maxReadLength),
  };
}

export function projectLegacyUserPost(action: any) {
  return {
    id: action?.post_id ?? action?.id ?? null,
    topic_id: action?.topic_id,
    post_number: action?.post_number,
    slug: action?.slug,
    title: action?.title,
    created_at: action?.created_at,
    excerpt: action?.excerpt || null,
    category_id: action?.category_id || null,
  };
}

export const listUserActionsTool = defineTool({
  name: "discourse_list_user_actions",
  title: "List User Actions",
  description: "List a user's visible activity using model-friendly action names. Plugin-backed action families can legitimately be empty; emptiness does not prove that a feature is unavailable.",
  schema,
  availability: "always",
  toolsets: ["activity"],
  annotations: readAnnotations(),
  handler: async ({ username, acting_username, action_types, offset = 0, limit = 30 }, _extra, ctx) => {
    try {
      const { base, client } = ctx.siteState.ensureSelectedSite();
      const filter = action_types?.map((name) => USER_ACTION_TYPES[name]).join(",");
      const upstreamLimit = limit < 100 ? limit + 1 : limit;
      const path = `/user_actions.json${queryString({ username, acting_username, offset, limit: upstreamLimit, filter })}`;
      const data = await withRateLimit(`discourse-api:${base}`, () => client.get(path), 200) as any;
      const upstream = Array.isArray(data?.user_actions) ? data.user_actions : [];
      const rows = upstream.slice(0, limit).map((action: any) => projectUserAction(action, ctx.maxReadLength));
      const hasMore = limit < 100 ? upstream.length > limit : undefined;
      return jsonResponse({ actions: rows, categories: Array.isArray(data?.categories) ? data.categories : [], meta: { offset, limit, returned: rows.length, has_more: hasMore ?? null, next_offset: hasMore ? offset + rows.length : null } });
    } catch (error) {
      return upstreamError(`Failed to list actions for ${username}`, error);
    }
  },
});
