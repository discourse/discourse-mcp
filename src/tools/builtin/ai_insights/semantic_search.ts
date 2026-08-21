import { z } from "zod";
import { defineTool } from "../../definition.js";
import { jsonResponse, withRateLimit } from "../../../util/json_response.js";
import { projectSearch } from "../common/post_projection.js";
import { queryString, readAnnotations } from "../common/helpers.js";
import { aiInsightError } from "./common.js";

const schema = z.object({ query: z.string().min(1), hyde: z.literal(false).optional().describe("Explicitly disable HyDE. Omit to use the site's configured behavior; upstream does not reliably support enabling it per request.") });

export const aiSemanticSearchTool = defineTool({
  name: "discourse_ai_semantic_search",
  title: "Discourse AI Semantic Search",
  description: "Run Guardian-filtered Discourse AI semantic search and return bounded grouped post/topic evidence. Requires Discourse AI embeddings. Results are bounded and expose no fabricated page cursor.",
  schema,
  availability: "always",
  toolsets: ["ai_insights"],
  annotations: readAnnotations(),
  handler: async ({ query, hyde }, _extra, ctx) => {
    try {
      const { base, client } = ctx.siteState.ensureSelectedSite();
      const data = await withRateLimit(`discourse-api:${base}`, () => client.get(`/discourse-ai/embeddings/semantic-search.json${queryString({ q: query, hyde })}`), 200) as any;
      return jsonResponse({ ...projectSearch(data, ctx.maxReadLength), meta: { term: data?.term ?? query, has_more: null, upstream_more_full_page_results: data?.more_full_page_results ?? null, exhaustive: false, cursor: null, hyde: hyde === false ? "disabled" : "site_default" } });
    } catch (error) {
      return aiInsightError("Semantic search failed", error);
    }
  },
});
