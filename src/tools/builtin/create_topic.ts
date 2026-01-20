import { z } from "zod";
import type { RegisterFn } from "../types.js";
import { jsonResponse, jsonError, rateLimit, isZodError, zodError } from "../../util/json_response.js";
import { requireWriteAccess } from "../../util/access.js";

export const registerCreateTopic: RegisterFn = (server, ctx, opts) => {
  if (!opts.allowWrites) return;

  const schema = z.object({
    title: z.string().min(1).max(300),
    raw: z.string().min(1).max(30000),
    category_id: z.number().int().positive().optional(),
    tags: z.array(z.string().min(1).max(100)).max(10).optional(),
    author_username: z.string().optional(),
  });

  server.registerTool(
    "discourse_create_topic",
    {
      title: "Create Topic",
      description: "Create a new topic. Returns JSON with id, topic_id, slug, and title.",
      inputSchema: schema.shape,
    },
    async (input, _extra) => {
      try {
        const { title, raw, category_id, tags, author_username } = schema.parse(input);

        const accessError = requireWriteAccess(ctx.siteState, opts.allowWrites);
        if (accessError) return accessError;

        await rateLimit("topic");

        const { client } = ctx.siteState.ensureSelectedSite();

        const payload: any = { title, raw };
        const headers: Record<string, string> = {};

        if (typeof category_id === "number") payload.category = category_id;
        if (Array.isArray(tags) && tags.length > 0) payload.tags = tags;
        if (author_username && author_username.length > 0) headers["Api-Username"] = author_username;

        const data: any = await client.post(`/posts.json`, payload, { headers });

        return jsonResponse({
          id: data?.id || data?.post?.id,
          topic_id: data?.topic_id || data?.topicId || data?.topic?.id,
          slug: data?.topic_slug || data?.topic?.slug || null,
          title: data?.topic_title || data?.title || title,
        });
      } catch (e: unknown) {
        if (isZodError(e)) return zodError(e);
        const err = e as any;
        return jsonError(`Failed to create topic: ${err?.message || String(e)}`);
      }
    }
  );
};

