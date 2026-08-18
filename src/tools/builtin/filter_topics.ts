import { z } from "zod";
import { defineTool } from "../definition.js";
import { jsonResponse, jsonError, zodError } from "../../util/json_response.js";

const topPeriodSchema = z.enum(["daily", "weekly", "monthly", "quarterly", "yearly", "all"]);

const schema = z
  .object({
    filter: z.string().optional().describe("TopicsFilter query (required for the filtered view)"),
    view: z.enum(["filtered", "top", "hot"]).optional().default("filtered"),
    top_period: topPeriodSchema.optional().describe("Top period (top view only; defaults to weekly)"),
    page: z.number().int().min(0).optional().describe("Page number (0-based, default: 0)"),
    per_page: z.number().int().min(1).max(50).optional().describe("Items per page (default 20, max 50)"),
  })
  .strict();

const description =
  "Discover topics through a filtered, top, or hot view. Filtered uses Discourse TopicsFilter syntax; top uses Discourse's authoritative top score and defaults to weekly; hot is defined exactly as daily top (not sentiment, controversy, or real-time velocity). Returns a uniform rich topic projection and truthful pagination metadata.";

function optional(value: unknown): unknown {
  return value === undefined ? null : value;
}

/** Normalize a topic-list serializer record without inventing missing values. */
export function projectTopic(topic: any) {
  const posters = Array.isArray(topic?.posters)
    ? topic.posters.map((poster: any) => ({
        user_id: optional(poster?.user_id),
        username: optional(poster?.username),
        description: optional(poster?.description),
      }))
    : null;
  const lastPoster = posters?.find((poster: any) =>
    typeof poster.description === "string" && /most recent poster/i.test(poster.description),
  );

  return {
    id: optional(topic?.id),
    slug: optional(topic?.slug),
    title: optional(topic?.title ?? topic?.fancy_title),
    category_id: optional(topic?.category_id),
    tags: Array.isArray(topic?.tags) ? topic.tags : null,
    created_at: optional(topic?.created_at),
    last_posted_at: optional(topic?.last_posted_at),
    bumped_at: optional(topic?.bumped_at),
    posts_count: optional(topic?.posts_count),
    reply_count: optional(topic?.reply_count),
    views: optional(topic?.views),
    like_count: optional(topic?.like_count),
    posters_count: optional(topic?.posters_count),
    closed: optional(topic?.closed),
    archived: optional(topic?.archived),
    pinned: optional(topic?.pinned),
    visible: optional(topic?.visible),
    last_poster_username: optional(topic?.last_poster_username ?? lastPoster?.username),
    posters,
  };
}

function authoritativeTotal(data: any, list: any): number | undefined {
  for (const value of [list?.total, list?.total_count, data?.total, data?.total_count]) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

export const filterTopicsTool = defineTool({
  name: "discourse_filter_topics",
  title: "Filter Topics",
  description,
  schema,
  availability: "always",
  toolsets: ["search", "topics"],
  handler: async (input, _extra, ctx, _opts) => {
    const parsed = schema.safeParse(input);
    if (!parsed.success) return zodError(parsed.error);
    const { filter, view, top_period, page = 0, per_page = 20 } = parsed.data;
    const trimmedFilter = filter?.trim();
    if (view === "filtered" && !trimmedFilter) {
      return jsonError("Validation failed", { issues: [{ path: "filter", message: "A nonblank filter is required for the filtered view" }] });
    }
    if (view !== "filtered" && trimmedFilter) {
      return jsonError("Validation failed", { issues: [{ path: "filter", message: "filter is only supported by the filtered view" }] });
    }
    if (view !== "top" && top_period !== undefined) {
      return jsonError("Validation failed", { issues: [{ path: "top_period", message: "top_period is only supported by the top view" }] });
    }

    try {
      const { client } = ctx.siteState.ensureSelectedSite();
      const params = new URLSearchParams();
      let path: string;
      let period: z.infer<typeof topPeriodSchema> | null = null;
      if (view === "filtered") {
        params.set("q", trimmedFilter!);
        params.set("page", String(page));
        params.set("per_page", String(per_page));
        path = `/filter.json?${params.toString()}`;
      } else {
        period = view === "hot" ? "daily" : (top_period ?? "weekly");
        params.set("period", period);
        params.set("page", String(page));
        params.set("per_page", String(per_page));
        path = `/top.json?${params.toString()}`;
      }

      const data = await client.get(path) as any;
      const list = data?.topic_list ?? data;
      const upstreamTopics: any[] = Array.isArray(list?.topics) ? list.topics : [];
      const hasContinuation = Boolean(list?.more_topics_url ?? list?.more_url ?? data?.more_topics_url ?? data?.more_url);
      const hasExtraRow = upstreamTopics.length > per_page;
      const results = upstreamTopics.slice(0, per_page).map(projectTopic);
      const total = authoritativeTotal(data, list);
      const meta: Record<string, unknown> = {
        view,
        top_period: period,
        page,
        per_page,
        returned: results.length,
        has_more: hasContinuation || hasExtraRow,
      };
      if (total !== undefined) meta.total = total;
      return jsonResponse({ results, meta });
    } catch (e: any) {
      return jsonError(`Failed to discover topics: ${e?.message || String(e)}`);
    }
  },
});
