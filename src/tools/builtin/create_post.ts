import { z } from "zod";
import type { RegisterFn } from "../types.js";
import { jsonResponse, jsonError, rateLimit, isZodError, zodError } from "../../util/json_response.js";

export const registerCreatePost: RegisterFn = (server, ctx, opts) => {
  if (!opts.allowWrites) return;

  const schema = z.object({
    topic_id: z.number().int().positive(),
    raw: z.string().min(1).max(30000),
    author_username: z.string().optional(),
  });

  server.registerTool(
    "discourse_create_post",
    {
      title: "Create Post",
      description: "Create a post in a topic. Returns JSON with id, topic_id, and post_number.",
      inputSchema: schema.shape,
    },
    async (input, _extra) => {
      try {
        const { topic_id, raw, author_username } = schema.parse(input);

        await rateLimit("post");

        const { client } = ctx.siteState.ensureSelectedSite();
        const payload: any = { topic_id, raw };
        const headers: Record<string, string> = {};

        if (author_username && author_username.length > 0) headers["Api-Username"] = author_username;

        const data = (await client.post(`/posts.json`, payload, { headers })) as any;

        return jsonResponse({
          id: data?.id || data?.post?.id,
          topic_id: data?.topic_id || topic_id,
          post_number: data?.post_number || data?.post?.post_number,
        });
      } catch (e: unknown) {
        if (isZodError(e)) return zodError(e);
        const err = e as any;
        return jsonError(`Failed to create post: ${err?.message || String(e)}`);
      }
    }
  );
};

