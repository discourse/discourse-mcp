import { z } from "zod";
import type { RegisterFn } from "../types.js";

export const registerReadTopic: RegisterFn = (server, ctx) => {
  const schema = z.object({
    topic_id: z.number().int().positive(),
    post_limit: z.number().int().min(1).max(100).optional(),
    start_post_number: z.number().int().min(1).optional().describe("Start from this post number (1-based)")
  });

  server.registerTool(
    "discourse_read_topic",
    {
      title: "Read Topic",
      description: "Read a topic metadata and first N posts.",
      inputSchema: schema.shape,
    },
    async ({ topic_id, post_limit = 5, start_post_number }, _extra: any) => {
      try {
        const { base, client } = ctx.siteState.ensureSelectedSite();
        const start = start_post_number ?? 1;

        // First request to load metadata/title and initial chunk
        let current = start;
        let fetchedPosts: Array<{ number: number; username: string; created_at: string; content: string }> = [];
        let slug = "";
        let title = `Topic ${topic_id}`;
        let category = "";
        let tags: string[] = [];

        const maxBatches = 10; // safety guard
        const limit = Number.isFinite(ctx.maxReadLength) ? ctx.maxReadLength : 50000;
        for (let i = 0; i < maxBatches && fetchedPosts.length < post_limit; i++) {
          // Ask for raw content when possible
          const url = current > 1 ? `/t/${topic_id}.json?post_number=${current}&include_raw=true` : `/t/${topic_id}.json?include_raw=true`;
          const data = (await client.get(url)) as any;
          if (i === 0) {
            title = data?.title || title;
            category = data?.category_id ? `Category ID ${data.category_id}` : "";
            tags = Array.isArray(data?.tags) ? data.tags : [];
            slug = data?.slug || String(topic_id);
          }
          const stream: any[] = Array.isArray(data?.post_stream?.posts) ? data.post_stream.posts : [];
          const sorted = stream.slice().sort((a, b) => (a.post_number || 0) - (b.post_number || 0));
          const filtered = sorted.filter((p) => (p.post_number || 0) >= current);
          for (const p of filtered) {
            if (fetchedPosts.length >= post_limit) break;
            fetchedPosts.push({
              number: p.post_number,
              username: p.username,
              created_at: p.created_at,
              content: (p.raw || p.cooked || p.excerpt || "").toString().slice(0, limit),
            });
          }
          if (filtered.length === 0) break; // no progress
          current = (filtered[filtered.length - 1]?.post_number || current) + 1;
        }

        const lines: string[] = [];
        lines.push(`# ${title}`);
        if (category) lines.push(category);
        if (tags.length) lines.push(`Tags: ${tags.join(", ")}`);
        lines.push("");
        for (const p of fetchedPosts) {
          lines.push(`- Post #${p.number} by @${p.username} (${p.created_at})`);
          lines.push(`  ${p.content}`);
        }
        lines.push("");
        lines.push(`Link: ${base}/t/${slug}/${topic_id}`);
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Failed to read topic ${topic_id}: ${e?.message || String(e)}` }], isError: true };
      }
    }
  );
};

