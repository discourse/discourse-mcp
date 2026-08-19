import { z } from "zod";
import { defineTool } from "../../definition.js";
import { requireActingUserAccess, requireWriteAccess } from "../../../util/access.js";
import { isZodError, jsonError, jsonResponse, rateLimit, zodError } from "../../../util/json_response.js";
import { actingUserHeaders, assertPrivateMessage, normalizePostResult, optionalAuthorUsernameSchema } from "./common.js";

const schema = z.object({
  topic_id: z.number().int().positive(),
  raw: z.string().min(1).max(30000),
  reply_to_post_number: z.number().int().positive().optional(),
  author_username: optionalAuthorUsernameSchema,
});

export const replyPrivateMessageTool = defineTool({
  name: "discourse_reply_private_message",
  title: "Reply to Private Message",
  description: "Safely reply to an existing private message after verifying its archetype. author_username requires a global API key; the response reports actual attribution.",
  schema,
  availability: "writes_enabled",
  toolsets: ["private_messages"],
  handler: async (input, _extra, ctx, opts) => {
    let topicId: number | undefined;
    try {
      const { topic_id, raw, reply_to_post_number, author_username } = schema.parse(input);
      topicId = topic_id;
      const accessError = requireWriteAccess(ctx.siteState, opts.allowWrites);
      if (accessError) return accessError;
      const actingUserError = requireActingUserAccess(ctx.siteState, author_username);
      if (actingUserError) return actingUserError;
      const { client } = ctx.siteState.ensureSelectedSite();
      const headers = actingUserHeaders(author_username);
      assertPrivateMessage(await client.get(`/t/${topic_id}.json?track_visit=false`, { headers }));
      await rateLimit("post");
      const payload: Record<string, unknown> = { topic_id, raw };
      if (reply_to_post_number !== undefined) payload.reply_to_post_number = reply_to_post_number;
      const data = (await client.post("/posts.json", payload, { headers })) as any;
      const normalized = normalizePostResult(data, topic_id);
      return jsonResponse({
        ...normalized,
        reply_to_post_number: data?.reply_to_post_number ?? data?.post?.reply_to_post_number ?? reply_to_post_number ?? null,
        requested_author: author_username ?? null,
        author_applied: author_username ? (normalized.username ? normalized.username.toLowerCase() === author_username.toLowerCase() : null) : null,
      });
    } catch (e: unknown) {
      if (isZodError(e)) return zodError(e);
      const err = e as any;
      return jsonError(`Failed to reply to private message ${topicId ?? (input as any)?.topic_id}: ${err?.message || String(e)}`);
    }
  },
});
