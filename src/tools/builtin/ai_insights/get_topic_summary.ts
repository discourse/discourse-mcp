import { z } from "zod";
import { defineTool } from "../../definition.js";
import { jsonResponse, withRateLimit } from "../../../util/json_response.js";
import { bounded, readAnnotations } from "../common/helpers.js";
import { aiInsightError } from "./common.js";

const schema = z.object({ topic_id: z.number().int().positive() });

export const aiGetTopicSummaryTool = defineTool({
  name: "discourse_ai_get_topic_summary",
  title: "Get Discourse AI Topic Summary",
  description: "Retrieve an existing cached upstream Discourse AI topic summary, including algorithm and staleness evidence. Requires Discourse AI; this tool does not generate or claim complete MCP-authored output.",
  schema,
  availability: "always",
  toolsets: ["ai_insights"],
  annotations: readAnnotations(),
  handler: async ({ topic_id }, _extra, ctx) => {
    try {
      const { base, client } = ctx.siteState.ensureSelectedSite();
      const data = await withRateLimit(`discourse-api:${base}`, () => client.getCached(`/discourse-ai/summarization/t/${topic_id}.json`, 60_000), 200) as any;
      const summary = data?.ai_topic_summary ?? data ?? {};
      return jsonResponse({ topic_id, summarized_text: bounded(summary?.summarized_text, ctx.maxReadLength), algorithm: summary?.algorithm ?? null, outdated: summary?.outdated ?? null, new_posts_since_summary: summary?.new_posts_since_summary ?? null, updated_at: summary?.updated_at ?? null, can_regenerate: summary?.can_regenerate ?? null, source: "discourse_ai_cached_summary" });
    } catch (error) {
      return aiInsightError(`Failed to get AI summary for topic ${topic_id}`, error);
    }
  },
});
