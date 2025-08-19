import { z } from "zod";
import type { RegisterFn } from "../types.js";

export const registerFilterTopics: RegisterFn = (server, ctx) => {
  const schema = z
    .object({
      filter: z
        .string()
        .min(1)
        .describe(
          "Filter query, e.g. 'category:support status:open created-after:30 order:activity'"
        ),
      page: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("Page number (1-based)"),
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
    "Filter topics with a concise query language: use key:value tokens separated by spaces; " +
    "category/categories for categories (comma = OR, '=category' = without subcats, '-' prefix = exclude), " +
    "tag/tags (comma = OR, '+' = AND) and tag_group; status:(open|closed|archived|listed|unlisted|public) and personal in:(bookmarked|watching|tracking|muted|pinned); " +
    "dates: created/activity/latest-post-(before|after) with YYYY-MM-DD or N (days); " +
    "numeric: likes[-op]-(min|max), posts-(min|max), posters-(min|max), views-(min|max); " +
    "order: activity|created|latest-post|likes|likes-op|posters|title|views|category with optional -asc; " +
    "free text terms are matched full-text. Results are permission-aware.";

  server.registerTool(
    "discourse_filter_topics",
    {
      title: "Filter Topics",
      description,
      inputSchema: schema.shape,
    },
    async ({ filter, page = 1, per_page }, _extra: any) => {
      try {
        const { base, client } = ctx.siteState.ensureSelectedSite();
        const params = new URLSearchParams();
        params.set("q", filter);
        params.set("page", String(page));
        if (per_page) params.set("per_page", String(per_page));

        const data = (await client.get(`/filter.json?${params.toString()}`)) as any;
        const list = data?.topic_list ?? data;
        const topics: any[] = Array.isArray(list?.topics) ? list.topics : [];
        const perPage = per_page ?? list?.per_page ?? undefined;
        const moreUrl: string | undefined = list?.more_topics_url || list?.more_url || undefined;

        const items = topics.map((t) => ({
          id: t.id,
          title: t.title || t.fancy_title || `Topic ${t.id}`,
          slug: t.slug || String(t.id),
        }));

        const lines: string[] = [];
        lines.push(`Filter: "${filter}" — Page ${page}`);
        if (items.length === 0) {
          lines.push("No topics matched.");
        } else {
          let i = 1;
          for (const it of items) {
            const url = `${base}/t/${it.slug}/${it.id}`;
            lines.push(`${i}. ${it.title} – ${url}`);
            i++;
          }
        }

        // Build a compact JSON footer for structured extraction
        const jsonFooter: any = {
          page,
          per_page: perPage,
          results: items.map((it) => ({ id: it.id, title: it.title, url: `${base}/t/${it.slug}/${it.id}` })),
        };
        if (moreUrl) {
          const abs = moreUrl.startsWith("http") ? moreUrl : `${base}${moreUrl.startsWith("/") ? "" : "/"}${moreUrl}`;
          jsonFooter.next_url = abs;
        }

        const text = lines.join("\n") + "\n\n```json\n" + JSON.stringify(jsonFooter) + "\n```\n";
        return { content: [{ type: "text", text }] };
      } catch (e: any) {
        return {
          content: [{ type: "text", text: `Failed to filter topics: ${e?.message || String(e)}` }],
          isError: true,
        };
      }
    }
  );
};

