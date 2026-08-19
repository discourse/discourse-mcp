import { z } from "zod";
import { defineTool } from "../definition.js";
import { jsonResponse, rateLimit, isZodError, zodError } from "../../util/json_response.js";
import { requireActingUserAccess, requireWriteAccess } from "../../util/access.js";
import { mutationError } from "./common/helpers.js";

const schema = z.object({
  topic_id: z.number().int().positive(),
  raw: z.string().min(1).max(30000),
  author_username: z.string().optional(),
});

export const createPostTool = defineTool({
  name: "discourse_create_post",
  title: "Create Post",
  description: "Create a post in a topic. author_username requires a global API key. Returns the actual upstream author so callers can verify attribution.",
  schema,
  availability: "writes_enabled",
  toolsets: ["topics"],
  handler: async (input, _extra, ctx, opts) => {
    try {
      const { topic_id, raw, author_username } = schema.parse(input);

      const accessError = requireWriteAccess(ctx.siteState, opts.allowWrites);
      if (accessError) return accessError;
      const actingUserError = requireActingUserAccess(ctx.siteState, author_username);
      if (actingUserError) return actingUserError;

      await rateLimit("post");

      const { client } = ctx.siteState.ensureSelectedSite();
      const payload: any = { topic_id, raw };
      const headers: Record<string, string> = {};

      if (author_username && author_username.length > 0) headers["Api-Username"] = author_username;

      const data = (await client.post(`/posts.json`, payload, { headers })) as any;

      const actualAuthor = data?.username ?? data?.post?.username ?? null;
      const requestedAuthor = author_username || null;
      return jsonResponse({
        id: data?.id || data?.post?.id,
        topic_id: data?.topic_id || topic_id,
        post_number: data?.post_number || data?.post?.post_number,
        username: actualAuthor,
        requested_author: requestedAuthor,
        author_applied: requestedAuthor ? (actualAuthor ? actualAuthor.toLowerCase() === requestedAuthor.toLowerCase() : null) : null,
      });
    } catch (e: unknown) {
      if (isZodError(e)) return zodError(e);
      return mutationError("Failed to create post", e);
    }
  },
});
