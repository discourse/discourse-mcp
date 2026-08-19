import { z } from "zod";
import { defineTool } from "../../definition.js";
import { jsonResponse, withRateLimit } from "../../../util/json_response.js";
import { projectPost, projectTopic } from "../common/post_projection.js";
import { projectSideLoads } from "../common/side_loads.js";
import { readAnnotations, upstreamError } from "../common/helpers.js";

const schema = z.object({ query: z.string().min(1), page: z.number().int().min(1).max(10).optional() });

export const searchPostsTool = defineTool({
  name: "discourse_search_posts",
  title: "Search Posts",
  description: "Search post-level evidence with Discourse query syntax. Unlike discourse_search, this preserves matched posts, highlighted blurbs, authors, topics, categories, and truthful bounded continuation. This is keyword search, not Discourse AI semantic search.",
  schema,
  availability: "always",
  toolsets: ["search", "topics"],
  annotations: readAnnotations(),
  handler: async ({ query, page = 1 }, _extra, ctx) => {
    try {
      const { base, client } = ctx.siteState.ensureSelectedSite();
      const q = new URLSearchParams({ expanded: "true", q: ctx.defaultSearchPrefix ? `${ctx.defaultSearchPrefix} ${query}` : query, page: String(page) });
      const data = await withRateLimit(`discourse-api:${base}`, () => client.get(`/search.json?${q.toString()}`), 200) as any;
      const posts = (Array.isArray(data?.posts) ? data.posts : []).map((post: any) => projectPost(post, ctx.maxReadLength));
      return jsonResponse({
        posts,
        topics: (Array.isArray(data?.topics) ? data.topics : []).map(projectTopic),
        ...projectSideLoads(data),
        meta: { page, returned: posts.length, has_more: data?.more_full_page_results === true, exhaustive: false, term: data?.term ?? query },
      });
    } catch (error) {
      return upstreamError("Post search failed", error);
    }
  },
});
