import { z } from "zod";
import { defineTool } from "../../definition.js";
import { jsonResponse, withRateLimit } from "../../../util/json_response.js";
import { projectPost } from "../common/post_projection.js";
import { queryString, readAnnotations, upstreamError } from "../common/helpers.js";

const schema = z.object({
  post_id: z.number().int().positive(),
  mode: z.enum(["reply_ids", "direct_replies", "reply_history"]).optional().describe("reply_ids returns recursive descendant IDs; direct_replies returns up to 20 rich direct replies; reply_history returns ancestors"),
  after_post_number: z.number().int().min(0).optional(),
});

export const getPostRepliesTool = defineTool({
  name: "discourse_get_post_replies",
  title: "Get Post Replies",
  description: "Read reply relationships for a post as recursive descendant IDs, bounded rich direct replies, or the upstream-bounded ancestor history. Preserves upstream ordering and references.",
  schema,
  availability: "always",
  toolsets: ["activity"],
  annotations: readAnnotations(),
  handler: async ({ post_id, mode = "reply_ids", after_post_number }, _extra, ctx) => {
    try {
      const { base, client } = ctx.siteState.ensureSelectedSite();
      const path = mode === "reply_ids"
        ? `/posts/${post_id}/reply-ids.json`
        : mode === "reply_history"
          ? `/posts/${post_id}/reply-history.json`
          : `/posts/${post_id}/replies.json${queryString({ after: after_post_number })}`;
      const data = await withRateLimit(`discourse-api:${base}`, () => client.get(path), 200) as any;
      if (mode === "reply_ids") {
        const replies = Array.isArray(data) ? data.map((item: any) => ({ id: item?.id ?? null, level: item?.level ?? null })) : [];
        return jsonResponse({ post_id, mode, replies, meta: { returned: replies.length, exhaustive: false, upstream_bounded: "recursive descendants up to depth 1000" } });
      }
      const rows = Array.isArray(data) ? data : [];
      return jsonResponse({
        post_id,
        mode,
        posts: rows.map((post: any) => projectPost(post, ctx.maxReadLength, { includeRaw: true })),
        meta: { returned: rows.length, has_more: null, page_was_full: mode === "direct_replies" ? rows.length === 20 : null, upstream_limit: mode === "direct_replies" ? 20 : "site max_reply_history" },
      });
    } catch (error) {
      return upstreamError(`Failed to get replies for post ${post_id}`, error);
    }
  },
});
