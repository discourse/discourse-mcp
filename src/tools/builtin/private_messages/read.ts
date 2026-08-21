import { z } from "zod";
import { defineTool } from "../../definition.js";
import { requireAuthenticatedAccess } from "../../../util/access.js";
import { jsonError, jsonResponse } from "../../../util/json_response.js";
import { assertPrivateMessage, normalizeGroup, normalizeUser } from "./common.js";

import { readAnnotations } from "../common/helpers.js";

const schema = z.object({
  topic_id: z.number().int().positive(),
  post_limit: z.number().int().min(1).max(50).optional().describe("Max posts to return (default 5, max 50)"),
  start_post_number: z.number().int().min(1).optional().describe("Start from this post number (1-based)"),
});

export const readPrivateMessageTool = defineTool({
  name: "discourse_read_private_message",
  title: "Read Private Message",
  description: "Read an authenticated private message, its posts, and direct allowed-user and allowed-group records. Rejects public topics.",
  schema,
  availability: "always",
  toolsets: ["private_messages"],
  annotations: readAnnotations(),
  handler: async ({ topic_id, post_limit = 5, start_post_number }, _extra, ctx, _opts) => {
    try {
      const accessError = requireAuthenticatedAccess(ctx.siteState);
      if (accessError) return accessError;
      const { client } = ctx.siteState.ensureSelectedSite();
      const start = start_post_number ?? 1;
      let current = start;
      const posts: Array<Record<string, unknown>> = [];
      let topicData: any = null;
      const limit = Number.isFinite(ctx.maxReadLength) ? ctx.maxReadLength : 50000;

      for (let i = 0; i < 10 && posts.length < post_limit; i++) {
        const path = current > 1
          ? `/t/${topic_id}.json?post_number=${current}&include_raw=true`
          : `/t/${topic_id}.json?include_raw=true`;
        const data = (await client.get(path)) as any;
        if (i === 0) {
          assertPrivateMessage(data);
          topicData = data;
        }
        const stream = Array.isArray(data?.post_stream?.posts) ? data.post_stream.posts : [];
        const filtered = stream.slice().sort((a: any, b: any) => (a?.post_number ?? 0) - (b?.post_number ?? 0))
          .filter((post: any) => (post?.post_number ?? 0) >= current);
        for (const post of filtered) {
          if (posts.length >= post_limit) break;
          posts.push({
            id: post?.id,
            post_number: post?.post_number,
            reply_to_post_number: post?.reply_to_post_number ?? null,
            user_id: post?.user_id ?? null,
            username: post?.username || "",
            created_at: post?.created_at,
            raw: String(post?.raw ?? post?.cooked ?? post?.excerpt ?? "").slice(0, limit),
          });
        }
        if (filtered.length === 0) break;
        current = (filtered[filtered.length - 1]?.post_number ?? current) + 1;
      }

      return jsonResponse({
        topic_id,
        slug: topicData?.slug || String(topic_id),
        title: topicData?.title || `Private message ${topic_id}`,
        archetype: "private_message",
        subtype: topicData?.subtype ?? null,
        posts_count: topicData?.posts_count ?? posts.length,
        last_read_post_number: topicData?.last_read_post_number ?? null,
        topic_archived: topicData?.archived ?? false,
        message_archived: topicData?.message_archived ?? false,
        allowed_users: (Array.isArray(topicData?.details?.allowed_users) ? topicData.details.allowed_users : []).map(normalizeUser),
        allowed_groups: (Array.isArray(topicData?.details?.allowed_groups) ? topicData.details.allowed_groups : []).map(normalizeGroup),
        posts,
        meta: {
          start_post: start,
          returned: posts.length,
          has_more: (topicData?.posts_count ?? 0) > start + posts.length - 1,
        },
      });
    } catch (e: any) {
      return jsonError(`Failed to read private message ${topic_id}: ${e?.message || String(e)}`);
    }
  },
});
