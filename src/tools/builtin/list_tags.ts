import type { RegisterFn } from "../types.js";
import { z } from "zod";

export const registerListTags: RegisterFn = (server, ctx) => {
  const schema = z.object({}).strict();
  server.registerTool(
    "discourse.list_tags",
    {
      title: "List Tags",
      description: "List tags (if enabled).",
      inputSchema: schema.shape,
    },
    async (_args, _extra: any) => {
      try {
        const data = (await ctx.client.get(`/tags.json`)) as any;
        const tags: any[] = data?.tags || [];
        const lines = tags.map((t) => `- ${t.id} (${t.count ?? 0})`);
        const text = lines.length ? lines.join("\n") : "No tags found or tags disabled.";
        return { content: [{ type: "text", text }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Failed to list tags: ${e?.message || String(e)}` }], isError: true };
      }
    }
  );
};

