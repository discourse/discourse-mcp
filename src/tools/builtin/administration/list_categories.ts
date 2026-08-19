import { z } from "zod";
import { defineTool } from "../../definition.js";
import { jsonResponse, transformCategory } from "../../../util/json_response.js";
import { readAnnotations, upstreamError } from "../common/helpers.js";

export const listCategoriesTool = defineTool({
  name: "discourse_list_categories",
  title: "List Categories",
  description: "List categories visible to the selected Discourse identity with IDs, hierarchy, access flags, and topic/post counts. Use this before category-scoped writes instead of guessing an ID.",
  schema: z.object({}),
  availability: "always",
  toolsets: ["administration"],
  annotations: readAnnotations(),
  handler: async (_input, _extra, ctx) => {
    try {
      const { client } = ctx.siteState.ensureSelectedSite();
      const data = await client.getCached("/site.json", 30_000) as any;
      const categories = (Array.isArray(data?.categories) ? data.categories : []).map(transformCategory);
      return jsonResponse({ categories, meta: { total: categories.length, cached_seconds: 30 } });
    } catch (error) {
      return upstreamError("Failed to list categories", error);
    }
  },
});
