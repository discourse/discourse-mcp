import { z } from "zod";
import type { RegisterFn } from "../types.js";

let lastTopicAt = 0;

export const registerCreateTopic: RegisterFn = (server, ctx, opts) => {
  if (!opts.allowWrites) return; // disabled by default

  const schema = z.object({
    title: z.string().min(1).max(300),
    raw: z.string().min(1).max(30000),
    category_id: z.number().int().positive().optional(),
    tags: z.array(z.string().min(1).max(100)).max(10).optional(),
  });

  server.registerTool(
    "discourse_create_topic",
    {
      title: "Create Topic",
      description: "Create a new topic with the given title and first post.",
      inputSchema: schema.shape,
    },
    async (input: any, _extra: any) => {
      const { title, raw, category_id, tags } = schema.parse(input);

      // Simple 1 req/sec rate limit
      const now = Date.now();
      if (now - lastTopicAt < 1000) {
        const wait = 1000 - (now - lastTopicAt);
        await new Promise((r) => setTimeout(r, wait));
      }
      lastTopicAt = Date.now();

      try {
        const { base, client } = ctx.siteState.ensureSelectedSite();

        const payload: any = { title, raw };
        if (typeof category_id === "number") payload.category = category_id;
        if (Array.isArray(tags) && tags.length > 0) payload.tags = tags;

        const data: any = await client.post(`/posts.json`, payload);

        const topicId = data?.topic_id || data?.topicId || data?.topic?.id;
        const slug = data?.topic_slug || data?.topic?.slug;
        const postNumber = data?.post_number || data?.post?.post_number || 1;
        const titleOut = data?.topic_title || data?.title || title;

        const link = topicId
          ? slug
            ? `${base}/t/${slug}/${topicId}`
            : `${base}/t/${topicId}/${postNumber}`
          : `${base}/latest`;

        return { content: [{ type: "text", text: `Created topic "${titleOut}": ${link}` }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Failed to create topic: ${e?.message || String(e)}` }], isError: true };
      }
    }
  );
};


