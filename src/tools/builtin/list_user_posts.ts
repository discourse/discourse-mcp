import { z } from "zod";
import type { RegisterFn } from "../types.js";
import { jsonResponse, jsonError, paginatedResponse } from "../../util/json_response.js";

export const registerListUserPosts: RegisterFn = (server, ctx) => {
  const schema = z.object({
    username: z.string().min(1),
    page: z.number().int().min(0).optional(),
    limit: z.number().int().min(1).max(50).optional().describe("Posts per page (max 50, default 30)"),
  });

  server.registerTool(
    "discourse_list_user_posts",
    {
      title: "List User Posts",
      description: "Get paginated list of user posts/replies. Returns JSON object with posts array (id, topic_id, post_number, slug, title, created_at, excerpt, category_id) and meta (page, limit, has_more).",
      inputSchema: schema.shape,
    },
    async ({ username, page = 0, limit = 30 }, _extra) => {
      try {
        const { client } = ctx.siteState.ensureSelectedSite();
        const offset = page * limit;

        // The filter parameter 4,5 corresponds to posts and replies
        const data = (await client.get(
          `/user_actions.json?offset=${offset}&username=${encodeURIComponent(username)}&filter=4,5`
        )) as any;

        const userActions = data?.user_actions || [];

        const posts = userActions.slice(0, limit).map((action: any) => {
          const postId = action.post_id ?? action.id ?? null;
          return {
            id: postId,
            topic_id: action.topic_id,
            post_number: action.post_number,
            slug: action.slug,
            title: action.title,
            created_at: action.created_at,
            excerpt: action.excerpt || null,
            category_id: action.category_id || null,
          };
        });

        return jsonResponse(paginatedResponse("posts", posts, {
          page,
          limit,
          has_more: userActions.length >= limit,
        }));
      } catch (e: any) {
        return jsonError(`Failed to get posts for ${username}: ${e?.message || String(e)}`);
      }
    }
  );
};
