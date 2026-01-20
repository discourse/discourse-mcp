import { z } from "zod";
import type { RegisterFn } from "../types.js";
import { jsonResponse, jsonError } from "../../util/json_response.js";

export const registerReadTopic: RegisterFn = (server, ctx) => {
  const schema = z.object({
    topic_id: z.number().int().positive(),
    post_limit: z.number().int().min(1).max(50).optional().describe("Max posts to return (default 5, max 50)"),
    start_post_number: z.number().int().min(1).optional().describe("Start from this post number (1-based)")
  });

  server.registerTool(
    "discourse_read_topic",
    {
      title: "Read Topic",
      description: "Read topic metadata and posts. Returns JSON with id, title, slug, category_id, tags, and posts array.",
      inputSchema: schema.shape,
    },
    async ({ topic_id, post_limit = 5, start_post_number }, _extra: any) => {
      try {
        const { client } = ctx.siteState.ensureSelectedSite();
        const start = start_post_number ?? 1;

        let current = start;
        const fetchedPosts: Array<{
          id: number;
          post_number: number;
          username: string;
          created_at: string;
          raw: string;
        }> = [];
        let topicData: any = null;

        const maxBatches = 10;
        const limit = Number.isFinite(ctx.maxReadLength) ? ctx.maxReadLength : 50000;

        for (let i = 0; i < maxBatches && fetchedPosts.length < post_limit; i++) {
          const url = current > 1
            ? `/t/${topic_id}.json?post_number=${current}&include_raw=true`
            : `/t/${topic_id}.json?include_raw=true`;
          const data = (await client.get(url)) as any;

          if (i === 0) {
            topicData = data;
          }

          const stream: any[] = Array.isArray(data?.post_stream?.posts) ? data.post_stream.posts : [];
          const sorted = stream.slice().sort((a, b) => (a.post_number || 0) - (b.post_number || 0));
          const filtered = sorted.filter((p) => (p.post_number || 0) >= current);

          for (const p of filtered) {
            if (fetchedPosts.length >= post_limit) break;
            fetchedPosts.push({
              id: p.id,
              post_number: p.post_number,
              username: p.username,
              created_at: p.created_at,
              raw: (p.raw || p.cooked || p.excerpt || "").toString().slice(0, limit),
            });
          }

          if (filtered.length === 0) break;
          current = (filtered[filtered.length - 1]?.post_number || current) + 1;
        }

        return jsonResponse({
          id: topic_id,
          title: topicData?.title || `Topic ${topic_id}`,
          slug: topicData?.slug || String(topic_id),
          category_id: topicData?.category_id || null,
          tags: Array.isArray(topicData?.tags) ? topicData.tags : [],
          posts_count: topicData?.posts_count || fetchedPosts.length,
          posts: fetchedPosts,
          meta: {
            start_post: start,
            returned: fetchedPosts.length,
            has_more: (topicData?.posts_count || 0) > (start + fetchedPosts.length - 1),
          },
        });
      } catch (e: any) {
        return jsonError(`Failed to read topic ${topic_id}: ${e?.message || String(e)}`);
      }
    }
  );
};

