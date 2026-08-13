import { z } from "zod";
import { defineTool } from "../definition.js";
import { jsonResponse, jsonError, paginatedResponse } from "../../util/json_response.js";

const schema = z.object({
  query: z.string().min(1).describe("Search query"),
  max_results: z.number().int().min(1).max(50).optional(),
});

export const searchTool = defineTool({
  name: "discourse_search",
  title: "Discourse Search",
  description: "Search site content. Returns JSON object with results array of matching topics (id, slug, title) and meta (total, has_more).",
  schema,
  availability: "always",
  handler: async (args, _extra, ctx, _opts) => {
    const { query, max_results = 10 } = args;
    const { client } = ctx.siteState.ensureSelectedSite();
    const q = new URLSearchParams();
    q.set("expanded", "true");
    const fullQuery = ctx.defaultSearchPrefix ? `${ctx.defaultSearchPrefix} ${query}` : query;
    q.set("q", fullQuery);
    try {
      const data = (await client.get(`/search.json?${q.toString()}`)) as any;
      const topics: any[] = data?.topics || [];

      const results = topics.slice(0, max_results).map((t) => ({
        id: t.id,
        slug: t.slug,
        title: t.title,
      }));

      return jsonResponse(paginatedResponse("results", results, {
        total: results.length,
        has_more: topics.length > max_results,
      }));
    } catch (e: any) {
      return jsonError(`Search failed: ${e?.message || String(e)}`);
    }
  },
});

