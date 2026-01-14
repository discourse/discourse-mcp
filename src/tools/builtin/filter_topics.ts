import { z } from "zod";
import type { RegisterFn } from "../types.js";
import { jsonResponse, jsonError, paginatedResponse } from "../../util/json_response.js";

export const registerFilterTopics: RegisterFn = (server, ctx) => {
  const schema = z
    .object({
      filter: z
        .string()
        .min(1)
        .describe(
          "Filter query, e.g. 'category:support status:open created-after:30 order:activity'",
        ),
      page: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Page number (0-based, default: 0)"),
      per_page: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe("Items per page (max 50)"),
    })
    .strict();

  const description =
    "Filter topics with a concise query language. Returns JSON object with results array (id, slug, title) and meta (page, limit, has_more). " +
    "Query syntax: category/categories (comma=OR, '=category'=without subcats, '-'=exclude), " +
    "tag/tags (comma=OR, '+'=AND), status:(open|closed|archived|listed|unlisted|public), " +
    "in:(bookmarked|watching|tracking|muted|pinned), dates: created/activity-(before|after) YYYY-MM-DD or N days, " +
    "order: activity|created|latest-post|likes|views with optional -asc.";

  server.registerTool(
    "discourse_filter_topics",
    {
      title: "Filter Topics",
      description,
      inputSchema: schema.shape,
    },
    async ({ filter, page = 0, per_page = 20 }, _extra: any) => {
      try {
        const { client } = ctx.siteState.ensureSelectedSite();
        const params = new URLSearchParams();
        params.set("q", filter);
        params.set("page", String(page));
        params.set("per_page", String(per_page));

        const data = (await client.get(
          `/filter.json?${params.toString()}`,
        )) as any;
        const list = data?.topic_list ?? data;
        const topics: any[] = Array.isArray(list?.topics) ? list.topics : [];
        const moreUrl: string | undefined =
          list?.more_topics_url || list?.more_url || undefined;

        const slicedTopics = topics.slice(0, per_page);
        const hasMore = !!moreUrl || topics.length > per_page;

        const results = slicedTopics.map((t) => ({
          id: t.id,
          slug: t.slug || String(t.id),
          title: t.title || t.fancy_title || `Topic ${t.id}`,
        }));

        return jsonResponse(paginatedResponse("results", results, {
          page,
          limit: per_page,
          has_more: hasMore,
        }));
      } catch (e: any) {
        return jsonError(`Failed to filter topics: ${e?.message || String(e)}`);
      }
    },
  );
};
