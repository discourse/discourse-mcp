import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RegisterFn } from "../types.js";

export const registerSearch: RegisterFn = (server, ctx) => {
  const schema = z.object({
    query: z.string().min(1).describe("Search query"),
    with_private: z.boolean().optional(),
    max_results: z.number().int().min(1).max(50).optional(),
  });

  server.registerTool(
    "discourse_search",
    {
      title: "Discourse Search",
      description: "Search site content.",
      inputSchema: schema.shape,
    },
    async (args, _extra: any) => {
      const { query, with_private = false, max_results = 10 } = args;
      const q = new URLSearchParams();
      q.set("expanded", "true");
      q.set("q", query);
      try {
        const data = (await ctx.client.get(`/search.json?${q.toString()}`)) as any;
        const topics: any[] = data?.topics || [];
        const posts: any[] = data?.posts || [];

        const items = (topics.map((t) => ({
          type: "topic" as const,
          id: t.id,
          title: t.title,
          slug: t.slug,
        })) as Array<{ type: "topic"; id: number; title: string; slug: string }>).slice(0, max_results);

        const lines: string[] = [];
        lines.push(`Top results for "${query}":`);
        let idx = 1;
        for (const it of items) {
          const url = `${ctx.siteBase}/t/${it.slug}/${it.id}`;
          lines.push(`${idx}. ${it.title} – ${url}`);
          idx++;
        }

        const jsonFooter = {
          results: items.map((it) => ({ id: it.id, url: `${ctx.siteBase}/t/${it.slug}/${it.id}`, title: it.title })),
        };
        const text = lines.join("\n") + "\n\n```json\n" + JSON.stringify(jsonFooter) + "\n```\n";
        return { content: [{ type: "text", text }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Search failed: ${e?.message || String(e)}` }], isError: true };
      }
    }
  );
};

