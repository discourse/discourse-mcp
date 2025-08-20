import { z } from "zod";
import type { RegisterFn } from "../types.js";

export const registerReadPost: RegisterFn = (server, ctx) => {
  const schema = z.object({
    post_id: z.number().int().positive(),
  });

  server.registerTool(
    "discourse_read_post",
    {
      title: "Read Post",
      description: "Read a specific post.",
      inputSchema: schema.shape,
    },
    async ({ post_id }, _extra: any) => {
      try {
        const { base, client } = ctx.siteState.ensureSelectedSite();
        // Prefer raw by asking API for include_raw
        const data = (await client.getCached(`/posts/${post_id}.json?include_raw=true`, 10000)) as any;
        const username = data?.username || data?.user_id || "user";
        const created = data?.created_at || "";
        const raw: string = data?.raw || data?.cooked || "";
        const limit = Number.isFinite(ctx.maxReadLength) ? ctx.maxReadLength : 50000;
        const content = raw.slice(0, limit);
        const url = data?.topic_slug && data?.topic_id
          ? `${base}/t/${data.topic_slug}/${data.topic_id}/${data.post_number}`
          : `${base}/posts/${post_id}`;
        const text = `Post by @${username} (${created})\n\n${content}${raw.length > content.length ? `\n… (+${raw.length - content.length} more)` : ""}\n\nLink: ${url}`;
        return { content: [{ type: "text", text }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Failed to read post ${post_id}: ${e?.message || String(e)}` }], isError: true };
      }
    }
  );
};

