import { z } from "zod";
import type { RegisterFn } from "../types.js";

export const registerListUserPosts: RegisterFn = (server, ctx) => {
  const schema = z.object({
    username: z.string().min(1),
    page: z.number().int().min(0).optional(),
  });

  server.registerTool(
    "discourse_list_user_posts",
    {
      title: "List User Posts",
      description: "Get a list of user posts and replies from a Discourse instance, with the most recent first. Returns 30 posts per page by default. Use the page parameter to paginate (page 0 = offset 0, page 1 = offset 30, etc.).",
      inputSchema: schema.shape,
    },
    async ({ username, page }, _extra: any) => {
      try {
        const { base, client } = ctx.siteState.ensureSelectedSite();
        const offset = (page || 0) * 30;

        // The filter parameter 4,5 corresponds to posts and replies
        const data = (await client.get(
          `/user_actions.json?offset=${offset}&username=${encodeURIComponent(username)}&filter=4,5`
        )) as any;

        const userActions = data?.user_actions || [];

        if (userActions.length === 0) {
          return {
            content: [{
              type: "text",
              text: page && page > 0
                ? `No more posts found for @${username} at page ${page}.`
                : `No posts found for @${username}.`
            }]
          };
        }

        const posts = userActions.map((action: any) => {
          const excerpt = action.excerpt || "";
          const truncated = action.truncated ? "..." : "";
          const date = action.created_at || "";
          const topicTitle = action.title || "";
          const topicSlug = action.slug || "";
          const topicId = action.topic_id || "";
          const postNumber = action.post_number || "";
          const categoryId = action.category_id || "";

          const postUrl = `${base}/t/${topicSlug}/${topicId}/${postNumber}`;

          return [
            `**${topicTitle}**`,
            `Posted: ${date}`,
            `Topic: ${postUrl}`,
            categoryId ? `Category ID: ${categoryId}` : undefined,
            excerpt ? `\n${excerpt}${truncated}` : undefined,
          ].filter(Boolean).join("\n");
        });

        const totalShown = userActions.length;
        const pageInfo = page && page > 0 ? ` (page ${page})` : "";
        const header = `Showing ${totalShown} posts for @${username}${pageInfo}:\n\n`;
        const footer = totalShown === 30 ? `\n\nTo see more posts, use page ${(page || 0) + 1}.` : "";

        return {
          content: [{
            type: "text",
            text: header + posts.join("\n\n---\n\n") + footer
          }]
        };
      } catch (e: any) {
        return {
          content: [{
            type: "text",
            text: `Failed to get posts for ${username}: ${e?.message || String(e)}`
          }],
          isError: true
        };
      }
    }
  );
};
