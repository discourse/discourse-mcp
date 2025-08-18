import { z } from "zod";
import type { RegisterFn } from "../types.js";

export const registerReadTopic: RegisterFn = (server, ctx) => {
  const schema = z.object({
    topic_id: z.number().int().positive(),
    post_limit: z.number().int().min(1).max(20).optional(),
  });

  server.registerTool(
    "discourse_read_topic",
    {
      title: "Read Topic",
      description: "Read a topic metadata and first N posts.",
      inputSchema: schema.shape,
    },
    async ({ topic_id, post_limit = 5 }, _extra: any) => {
      try {
        const { base, client } = ctx.siteState.ensureSelectedSite();
        const data = (await client.get(`/t/${topic_id}.json`)) as any;
        const title = data?.title || `Topic ${topic_id}`;
        const category = data?.category_id ? `Category ID ${data.category_id}` : "";
        const tags: string[] = data?.tags || [];

        const stream: any[] = data?.post_stream?.posts || [];
        const posts = stream.slice(0, post_limit).map((p) => ({
          number: p.post_number,
          username: p.username,
          created_at: p.created_at,
          excerpt: (p.excerpt || p.cooked || p.raw || "").toString().slice(0, 400),
        }));

        const lines: string[] = [];
        lines.push(`# ${title}`);
        if (category) lines.push(category);
        if (tags.length) lines.push(`Tags: ${tags.join(", ")}`);
        lines.push("");
        for (const p of posts) {
          lines.push(`- Post #${p.number} by @${p.username} (${p.created_at})`);
          lines.push(`  ${p.excerpt}`);
        }
        lines.push("");
        lines.push(`Link: ${base}/t/${data?.slug || topic_id}/${topic_id}`);
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Failed to read topic ${topic_id}: ${e?.message || String(e)}` }], isError: true };
      }
    }
  );
};

