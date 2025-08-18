import type { RegisterFn } from "../types.js";
import { z } from "zod";

export const registerListCategories: RegisterFn = (server, ctx) => {
  const schema = z.object({}).strict();
  server.registerTool(
    "discourse_list_categories",
    {
      title: "List Categories",
      description: "List categories visible to the current auth context.",
      inputSchema: schema.shape,
    },
    async (_args, _extra: any) => {
      try {
        const data = (await ctx.client.getCached(`/site.json`, 30000)) as any;
        const cats: any[] = data?.categories || [];
        const lines = cats.map((c) => `- ${c.name} (${c.topic_count ?? 0} topics)`);
        const text = lines.length ? lines.join("\n") : "No categories found.";
        return { content: [{ type: "text", text }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Failed to list categories: ${e?.message || String(e)}` }], isError: true };
      }
    }
  );
};
