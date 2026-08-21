import { z } from "zod";
import { defineTool } from "../definition.js";
import { jsonResponse, rateLimit, isZodError, zodError } from "../../util/json_response.js";
import { requireActingUserAccess, requireWriteAccess } from "../../util/access.js";
import { mutationError } from "./common/helpers.js";

const schema = z.object({
  title: z.string().min(1).max(300),
  raw: z.string().min(1).max(30000),
  category_id: z.number().int().positive().optional(),
  tags: z.array(z.string().min(1).max(100)).max(10).optional(),
  author_username: z.string().optional(),
});

export const createTopicTool = defineTool({
  name: "discourse_create_topic",
  title: "Create Topic",
  description: "Create a new topic. author_username requires a global API key. Returns the actual upstream author so callers can verify attribution.",
  schema,
  availability: "writes_enabled",
  toolsets: ["topics"],
  handler: async (input, _extra, ctx, opts) => {
    try {
      const { title, raw, category_id, tags, author_username } = schema.parse(input);

      const accessError = requireWriteAccess(ctx.siteState, opts.allowWrites);
      if (accessError) return accessError;
      const actingUserError = requireActingUserAccess(ctx.siteState, author_username);
      if (actingUserError) return actingUserError;

      await rateLimit("topic");

      const { client } = ctx.siteState.ensureSelectedSite();

      const payload: any = { title, raw };
      const headers: Record<string, string> = {};

      if (typeof category_id === "number") payload.category = category_id;
      if (Array.isArray(tags) && tags.length > 0) payload.tags = tags;
      if (author_username && author_username.length > 0) headers["Api-Username"] = author_username;

      const data: any = await client.post(`/posts.json`, payload, { headers });

      const actualAuthor = data?.username ?? data?.post?.username ?? null;
      const requestedAuthor = author_username || null;
      return jsonResponse({
        id: data?.id || data?.post?.id,
        topic_id: data?.topic_id || data?.topicId || data?.topic?.id,
        slug: data?.topic_slug || data?.topic?.slug || null,
        title: data?.topic_title || data?.title || title,
        username: actualAuthor,
        requested_author: requestedAuthor,
        author_applied: requestedAuthor ? (actualAuthor ? actualAuthor.toLowerCase() === requestedAuthor.toLowerCase() : null) : null,
      });
    } catch (e: unknown) {
      if (isZodError(e)) return zodError(e);
      return mutationError("Failed to create topic", e);
    }
  },
});

