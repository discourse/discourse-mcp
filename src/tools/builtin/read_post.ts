import { z } from "zod";
import { defineTool } from "../definition.js";
import { jsonResponse, jsonError } from "../../util/json_response.js";

import { readAnnotations } from "./common/helpers.js";

const schema = z.object({
  post_id: z.number().int().positive(),
});

export const readPostTool = defineTool({
  name: "discourse_read_post",
  title: "Read Post",
  description: "Read a specific post. Returns JSON with id, topic_id, post_number, username, created_at, and raw content.",
  schema,
  availability: "always",
  toolsets: ["topics"],
  annotations: readAnnotations(),
  handler: async ({ post_id }, _extra, ctx, _opts) => {
    try {
      const { client } = ctx.siteState.ensureSelectedSite();
      const data = (await client.getCached(`/posts/${post_id}.json?include_raw=true`, 10000)) as any;
      const limit = Number.isFinite(ctx.maxReadLength) ? ctx.maxReadLength : 50000;
      const raw: string = data?.raw || data?.cooked || "";

      return jsonResponse({
        id: data?.id || post_id,
        topic_id: data?.topic_id || null,
        topic_slug: data?.topic_slug || null,
        post_number: data?.post_number || null,
        username: data?.username || null,
        created_at: data?.created_at || null,
        raw: raw.slice(0, limit),
        truncated: raw.length > limit,
        ...(data && "accepted_answer" in data ? { accepted_answer: data.accepted_answer } : {}),
        ...(data && "topic_accepted_answer" in data ? { topic_accepted_answer: data.topic_accepted_answer } : {}),
      });
    } catch (e: any) {
      return jsonError(`Failed to read post ${post_id}: ${e?.message || String(e)}`);
    }
  },
});

