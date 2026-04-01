import { z } from "zod";
import type { RegisterFn } from "../types.js";
import { jsonResponse, jsonError, rateLimit, isZodError, zodError } from "../../util/json_response.js";
import { requireWriteAccess } from "../../util/access.js";

export const registerUpdatePost: RegisterFn = (server, ctx, opts) => {
  if (!opts?.allowWrites) return;

  const schema = z.object({
    post_id: z.number().int().positive().describe("Post ID to update"),
    raw: z.string().min(1).max(30000).describe("New post content (markdown)"),
    edit_reason: z.string().max(500).optional().describe("Reason for the edit"),
  });

  server.registerTool(
    "discourse_update_post",
    {
      title: "Update Post",
      description: "Update the content of an existing post. Returns JSON with updated post details.",
      inputSchema: schema.shape,
    },
    async (args, _extra) => {
      try {
        const { post_id, raw, edit_reason } = schema.parse(args);

        const accessError = requireWriteAccess(ctx.siteState, opts.allowWrites);
        if (accessError) return accessError;

        await rateLimit("post");

        const { client } = ctx.siteState.ensureSelectedSite();

        const payload: Record<string, any> = { post: { raw } };
        if (edit_reason !== undefined) {
          payload.post.edit_reason = edit_reason;
        }

        const data = (await client.put(
          `/posts/${encodeURIComponent(String(post_id))}.json`,
          payload
        )) as any;

        const post = data?.post || data;

        return jsonResponse({
          id: post.id ?? post_id,
          topic_id: post.topic_id ?? null,
          post_number: post.post_number ?? null,
          raw: post.raw ?? raw,
          updated_at: post.updated_at ?? null,
          edit_reason: post.edit_reason ?? edit_reason ?? null,
        });
      } catch (e: unknown) {
        if (isZodError(e)) return zodError(e);
        const err = e as any;
        const status = err?.status || err?.response?.status;
        const body = err?.body || err?.response?.body;

        if (status === 403) {
          return jsonError("Permission denied: cannot update this post", { status });
        }

        if (status === 422) {
          const errors = body?.errors || err?.message;
          return jsonError(`Validation failed: ${Array.isArray(errors) ? errors.join(", ") : errors}`, {
            status,
            body,
          });
        }

        const details: Record<string, unknown> = {};
        if (status) details.status = status;
        if (body) details.body = body;
        return jsonError(`Failed to update post: ${err?.message || String(e)}`, Object.keys(details).length > 0 ? details : undefined);
      }
    }
  );
};
