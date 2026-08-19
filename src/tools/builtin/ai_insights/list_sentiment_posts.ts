import { z } from "zod";
import { defineTool } from "../../definition.js";
import { requireAuthenticatedAccess } from "../../../util/access.js";
import { jsonResponse, withRateLimit } from "../../../util/json_response.js";
import { bounded, queryString, readAnnotations } from "../common/helpers.js";
import { aiInsightError } from "./common.js";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
const schema = z.object({
  group_by: z.enum(["category", "tag"]),
  group_value: z.string().min(1),
  start_date: isoDate.optional(),
  end_date: isoDate.optional(),
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).optional(),
});

export const aiListSentimentPostsTool = defineTool({
  name: "discourse_ai_list_sentiment_posts",
  title: "List Discourse AI Sentiment Posts",
  description: "List staff-visible posts classified positive, negative, or neutral by Discourse AI for an exact category/tag and date window. Classification is model output, not proof of tone, satisfaction, risk, or an argument.",
  schema,
  availability: "always",
  toolsets: ["ai_insights"],
  annotations: readAnnotations(),
  handler: async ({ group_by, group_value, start_date, end_date, limit = 50, offset = 0 }, _extra, ctx) => {
    const accessError = requireAuthenticatedAccess(ctx.siteState);
    if (accessError) return accessError;
    try {
      const { base, client } = ctx.siteState.ensureSelectedSite();
      const data = await withRateLimit(`discourse-api:${base}`, () => client.get(`/discourse-ai/sentiment/posts${queryString({ group_by, group_value, start_date, end_date, limit, offset })}`), 200) as any;
      const posts = (Array.isArray(data?.posts) ? data.posts : []).map((post: any) => ({
        id: post?.post_id ?? null,
        topic_id: post?.topic_id ?? null,
        topic_title: post?.topic_title ?? null,
        post_number: post?.post_number ?? null,
        username: post?.username ?? null,
        name: post?.name ?? null,
        category_id: post?.category_id ?? null,
        created_at: post?.created_at ?? null,
        excerpt: bounded(post?.excerpt, ctx.maxReadLength),
        truncated: post?.truncated ?? null,
        sentiment: post?.sentiment ?? null,
      }));
      return jsonResponse({ posts, meta: { limit, offset, returned: posts.length, has_more: data?.has_more === true, next_offset: data?.next_offset ?? null, classification_source: "discourse_ai_active_sentiment_model" } });
    } catch (error) {
      return aiInsightError("Failed to list sentiment posts", error);
    }
  },
});
