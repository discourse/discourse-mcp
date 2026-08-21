import { z } from "zod";
import { defineTool } from "../../definition.js";
import { jsonResponse, withRateLimit } from "../../../util/json_response.js";
import { projectPost } from "../common/post_projection.js";
import { queryString, readAnnotations, upstreamError } from "../common/helpers.js";

const schema = z.object({ before_post_id: z.number().int().positive().optional(), replies_only: z.boolean().optional() });

export const listLatestPostsTool = defineTool({
  name: "discourse_list_latest_posts",
  title: "List Latest Posts",
  description: "List the site's latest visible posts using Discourse's fixed 50-post page and post-ID cursor. Anonymous upstream responses expire after one minute; results are a feed, not an exhaustive history.",
  schema,
  availability: "always",
  toolsets: ["activity"],
  annotations: readAnnotations(),
  handler: async ({ before_post_id, replies_only = false }, _extra, ctx) => {
    try {
      const { base, client } = ctx.siteState.ensureSelectedSite();
      const data = await withRateLimit(`discourse-api:${base}`, () => client.get(`/posts.json${queryString({ before: before_post_id })}`), 200) as any;
      const upstream = Array.isArray(data?.latest_posts) ? data.latest_posts : [];
      const rows = replies_only ? upstream.filter((post: any) => (post?.post_number ?? 1) > 1) : upstream;
      return jsonResponse({
        posts: rows.map((post: any) => projectPost(post, ctx.maxReadLength, { includeRaw: true })),
        meta: {
          before_post_id: before_post_id ?? null,
          upstream_page_size: 50,
          upstream_returned: upstream.length,
          returned: rows.length,
          has_more: null,
          page_was_full: upstream.length === 50,
          next_before_post_id: upstream.length > 0 ? upstream.at(-1)?.id ?? null : null,
          replies_only_projection: replies_only,
          anonymous_cache_seconds: 60,
        },
      });
    } catch (error) {
      return upstreamError("Failed to list latest posts", error);
    }
  },
});
