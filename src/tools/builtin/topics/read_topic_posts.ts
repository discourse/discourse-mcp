import { z } from "zod";
import { defineTool } from "../../definition.js";
import { jsonResponse, zodError, withRateLimit } from "../../../util/json_response.js";
import { projectPost } from "../common/post_projection.js";
import { queryString, readAnnotations, upstreamError } from "../common/helpers.js";

const schema = z.object({
  topic_id: z.number().int().positive(),
  selection_mode: z.enum(["latest", "earliest", "post_ids", "around_post", "usernames"]),
  limit: z.number().int().min(1).max(50).optional(),
  post_ids: z.array(z.number().int().positive()).min(1).max(50).optional(),
  post_number: z.number().int().positive().optional(),
  usernames: z.array(z.string().min(1)).min(1).max(50).optional(),
  replies_only: z.boolean().optional(),
});

const selectionSchema = z.discriminatedUnion("selection_mode", [
  z.object({ selection_mode: z.literal("latest"), limit: z.number().int().min(1).max(50).optional(), replies_only: z.boolean().optional() }).strict(),
  z.object({ selection_mode: z.literal("earliest"), limit: z.number().int().min(1).max(50).optional(), replies_only: z.boolean().optional() }).strict(),
  z.object({ selection_mode: z.literal("post_ids"), post_ids: z.array(z.number().int().positive()).min(1).max(50) }).strict(),
  z.object({ selection_mode: z.literal("around_post"), post_number: z.number().int().positive(), limit: z.number().int().min(1).max(50).optional() }).strict(),
  z.object({ selection_mode: z.literal("usernames"), usernames: z.array(z.string().min(1)).min(1).max(50), limit: z.number().int().min(1).max(50).optional(), replies_only: z.boolean().optional() }).strict(),
]);

export const readTopicPostsTool = defineTool({
  name: "discourse_read_topic_posts",
  title: "Read Selected Topic Posts",
  description: "Read exact, earliest, latest, around-post, or username-filtered topic evidence. Selection is bounded to 50 posts and reports the visible stream size without claiming the entire topic was loaded.",
  schema,
  availability: "always",
  toolsets: ["topics"],
  annotations: readAnnotations(),
  handler: async (input, _extra, ctx) => {
    const { topic_id, ...selectionInput } = input;
    const parsed = selectionSchema.safeParse(Object.fromEntries(Object.entries(selectionInput).filter(([, value]) => value !== undefined)));
    if (!parsed.success) return zodError(parsed.error);
    try {
      const { base, client } = ctx.siteState.ensureSelectedSite();
      const selection = parsed.data;
      let streamIds: number[] | null = null;
      let selectedIds: number[] | null = null;
      let postsUrl: string;
      const limit = "limit" in selection ? (selection.limit ?? 20) : 50;

      if (selection.selection_mode === "post_ids") {
        selectedIds = selection.post_ids;
        postsUrl = `/t/${topic_id}/posts.json${queryString({ post_ids: selectedIds, include_raw: true })}`;
      } else if (selection.selection_mode === "around_post") {
        postsUrl = `/t/${topic_id}/posts.json${queryString({ post_number: selection.post_number, include_raw: true })}`;
      } else {
        const usernames = selection.selection_mode === "usernames" ? selection.usernames.join(",") : undefined;
        const idsData = await withRateLimit(`discourse-api:${base}`, () => client.get(`/t/${topic_id}/post_ids.json${queryString({ username_filters: usernames })}`), 200) as any;
        streamIds = Array.isArray(idsData?.post_ids) ? idsData.post_ids.filter(Number.isInteger) : [];
        let candidates: number[] = streamIds ?? [];
        if (selection.replies_only) candidates = candidates.slice(1);
        selectedIds = selection.selection_mode === "latest" ? candidates.slice(-limit) : candidates.slice(0, limit);
        if (selectedIds.length === 0) {
          return jsonResponse({ topic_id, selection_mode: selection.selection_mode, posts: [], meta: { visible_stream_size: (streamIds ?? []).length, selected: 0, returned: 0, max_requests: 2, actual_requests: 1, exhaustive: false } });
        }
        postsUrl = `/t/${topic_id}/posts.json${queryString({ post_ids: selectedIds, include_raw: true })}`;
      }

      const data = await withRateLimit(`discourse-api:${base}`, () => client.get(postsUrl), 200) as any;
      let posts = Array.isArray(data?.post_stream?.posts) ? data.post_stream.posts : [];
      if (selection.selection_mode === "around_post") posts = posts.slice(0, limit);
      if (selectedIds) {
        const order = new Map(selectedIds.map((id, index) => [id, index]));
        posts = posts.filter((post: any) => order.has(post.id)).sort((a: any, b: any) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
      } else posts = posts.slice().sort((a: any, b: any) => (a.post_number ?? 0) - (b.post_number ?? 0));

      return jsonResponse({
        topic_id,
        selection_mode: selection.selection_mode,
        posts: posts.map((post: any) => projectPost(post, ctx.maxReadLength, { includeRaw: true })),
        meta: {
          visible_stream_size: streamIds?.length ?? null,
          selected: selectedIds?.length ?? posts.length,
          returned: posts.length,
          max_requests: selection.selection_mode === "post_ids" || selection.selection_mode === "around_post" ? 1 : 2,
          exhaustive: false,
        },
      });
    } catch (error) {
      return upstreamError(`Failed to read posts for topic ${topic_id}`, error);
    }
  },
});
