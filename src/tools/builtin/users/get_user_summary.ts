import { z } from "zod";
import { defineTool } from "../../definition.js";
import { jsonResponse, withRateLimit } from "../../../util/json_response.js";
import { bounded, readAnnotations, upstreamError } from "../common/helpers.js";
import { projectSlimUser, projectTopic } from "../common/post_projection.js";

const schema = z.object({ username: z.string().min(1) });

export const getUserSummaryTool = defineTool({
  name: "discourse_get_user_summary",
  title: "Get User Summary",
  description: "Get profile-visible aggregate user activity, top topics/replies/links, interaction partners, categories, badges, likes, visits, reading, and post/topic counts. Missing metrics remain null when hidden or unavailable.",
  schema,
  availability: "always",
  toolsets: ["activity"],
  annotations: readAnnotations(),
  handler: async ({ username }, _extra, ctx) => {
    try {
      const { base, client } = ctx.siteState.ensureSelectedSite();
      const data = await withRateLimit(`discourse-api:${base}`, () => client.get(`/u/${encodeURIComponent(username)}/summary.json`), 200) as any;
      const summary = data?.user_summary ?? data ?? {};
      const metrics = ["likes_given", "likes_received", "topics_entered", "posts_read_count", "days_visited", "topic_count", "post_count", "time_read", "recent_time_read", "bookmark_count", "can_see_summary_stats", "can_see_user_actions"];
      const result: Record<string, unknown> = { username: summary?.username ?? username };
      for (const key of metrics) result[key] = summary?.[key] ?? null;
      result.top_topics = (summary?.top_topics ?? summary?.topics ?? []).map(projectTopic);
      result.top_replies = (summary?.top_replies ?? summary?.replies ?? []).map((row: any) => ({ ...projectTopic(row?.topic ?? row), post_id: row?.post_id ?? row?.id ?? null, post_number: row?.post_number ?? null, like_count: row?.like_count ?? null, created_at: row?.created_at ?? null, excerpt: bounded(row?.excerpt, ctx.maxReadLength) }));
      result.top_links = (summary?.top_links ?? summary?.links ?? []).map((link: any) => ({ url: link?.url ?? null, title: link?.title ?? null, clicks: link?.clicks ?? null, topic: projectTopic(link?.topic), post_number: link?.post_number ?? null }));
      for (const key of ["most_liked_by_users", "most_liked_users", "most_replied_to_users"]) result[key] = (summary?.[key] ?? []).map((user: any) => ({ ...projectSlimUser(user), count: user?.count ?? null }));
      result.top_categories = Array.isArray(summary?.top_categories) ? summary.top_categories : [];
      result.badges = Array.isArray(summary?.badges) ? summary.badges : [];
      return jsonResponse(result);
    } catch (error) {
      return upstreamError(`Failed to get summary for ${username}`, error);
    }
  },
});
