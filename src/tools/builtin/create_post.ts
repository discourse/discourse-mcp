import { z } from "zod";
import type { RegisterFn } from "../types.js";

let lastPostAt = 0;

export const registerCreatePost: RegisterFn = (server, ctx, opts) => {
  if (!opts.allowWrites) return; // disabled by default

  const schema = z.object({
    topic_id: z.number().int().positive(),
    raw: z.string().min(1).max(30000),
  });

  server.registerTool(
    "discourse_create_post",
    {
      title: "Create Post",
      description: "Create a post in a topic.",
      inputSchema: schema.shape,
    },
    async ({ topic_id, raw }, _extra: any) => {
      // Simple 1 req/sec rate limit
      const now = Date.now();
      if (now - lastPostAt < 1000) {
        const wait = 1000 - (now - lastPostAt);
        await new Promise((r) => setTimeout(r, wait));
      }
      lastPostAt = Date.now();

      try {
        const { base, client } = ctx.siteState.ensureSelectedSite();
        const data = (await client.post(`/posts.json`, { topic_id, raw })) as any;
        const postId = data?.id || data?.post?.id;
        const topicId = data?.topic_id || topic_id;
        const postNumber = data?.post_number || data?.post?.post_number;
        const link = postId && topicId && postNumber
          ? `${base}/t/${topicId}/${postNumber}`
          : `${base}/t/${topicId}`;
        return { content: [{ type: "text", text: `Created post: ${link}` }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Failed to create post: ${e?.message || String(e)}` }], isError: true };
      }
    }
  );
};

