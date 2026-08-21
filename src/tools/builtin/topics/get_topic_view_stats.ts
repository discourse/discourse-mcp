import { z } from "zod";
import { defineTool } from "../../definition.js";
import { jsonResponse, withRateLimit } from "../../../util/json_response.js";
import { queryString, readAnnotations, upstreamError } from "../common/helpers.js";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
const schema = z.object({ topic_id: z.number().int().positive(), from: isoDate.optional(), to: isoDate.optional() });

export const getTopicViewStatsTool = defineTool({
  name: "discourse_get_topic_view_stats",
  title: "Get Topic View Stats",
  description: "Get up to 300 ascending daily topic view counts. Views combine anonymous and logged-in views; they are not unique viewers or an engagement judgment.",
  schema,
  availability: "always",
  toolsets: ["activity"],
  annotations: readAnnotations(),
  handler: async ({ topic_id, from, to }, _extra, ctx) => {
    try {
      const { base, client } = ctx.siteState.ensureSelectedSite();
      const data = await withRateLimit(`discourse-api:${base}`, () => client.get(`/t/${topic_id}/view-stats.json${queryString({ from, to })}`), 200) as any;
      const source = Array.isArray(data) ? data : Array.isArray(data?.stats) ? data.stats : Array.isArray(data?.topic_view_stats) ? data.topic_view_stats : [];
      const rows = source.map((row: any) => ({ viewed_at: row?.viewed_at ?? row?.date ?? null, views: row?.views ?? row?.count ?? 0 })).sort((a: any, b: any) => String(a.viewed_at).localeCompare(String(b.viewed_at)));
      return jsonResponse({ topic_id, view_stats: rows, meta: { from: from ?? null, to: to ?? null, default_range_days: from || to ? null : 30, upstream_max_rows: 300, returned: rows.length } });
    } catch (error) {
      return upstreamError(`Failed to get view stats for topic ${topic_id}`, error);
    }
  },
});
