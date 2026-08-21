import { defineTool } from "../definition.js";
import { z } from "zod";
import { jsonResponse, jsonError } from "../../util/json_response.js";

import { readAnnotations } from "./common/helpers.js";

const schema = z.object({
  channel_id: z.number().int().positive().describe("The chat channel ID"),
  page_size: z.number().int().min(1).max(50).optional().describe("Number of messages to return (default: 50, max: 50)"),
  target_message_id: z.number().int().positive().optional().describe("Message ID to query around or paginate from"),
  direction: z.enum(["past", "future"]).optional().describe("Pagination direction: 'past' for older messages, 'future' for newer"),
  target_date: z.string().optional().describe("ISO 8601 date string to query messages around"),
}).strict();

export const getChatMessagesTool = defineTool({
  name: "discourse_get_chat_messages",
  title: "Get Chat Messages",
  description: "Get messages from a chat channel. Returns JSON object with channel_id, messages array (id, username, created_at, message, edited, thread_id, in_reply_to_id), and meta.",
  schema,
  availability: "always",
  toolsets: ["chat"],
  annotations: readAnnotations(),
  handler: async ({
    channel_id,
    page_size = 50,
    target_message_id,
    direction,
    target_date,
  }, _extra, ctx, _opts) => {
    try {
      const { client } = ctx.siteState.ensureSelectedSite();

      const params = new URLSearchParams();
      params.append("page_size", String(page_size));
      if (target_message_id !== undefined) params.append("target_message_id", String(target_message_id));
      if (direction) params.append("direction", direction);
      if (target_date) params.append("target_date", target_date);

      const url = `/chat/api/channels/${channel_id}/messages?${params.toString()}`;
      const data = (await client.get(url)) as any;

      const rawMessages: any[] = data?.messages || [];
      const meta = data?.meta || {};
      const limit = Number.isFinite(ctx.maxReadLength) ? ctx.maxReadLength : 50000;

      const messages = rawMessages.map((msg) => ({
        id: msg.id,
        username: msg.user?.username || null,
        created_at: msg.created_at || null,
        message: (msg.message || msg.cooked || "").toString().slice(0, limit),
        edited: msg.edited || false,
        thread_id: msg.thread_id || null,
        in_reply_to_id: msg.in_reply_to?.id || null,
      }));

      return jsonResponse({
        channel_id,
        messages,
        meta: {
          returned: messages.length,
          can_load_more_past: meta.can_load_more_past ?? false,
          can_load_more_future: meta.can_load_more_future ?? false,
          target_message_id: meta.target_message_id || null,
        },
      });
    } catch (e: any) {
      return jsonError(`Failed to get chat messages: ${e?.message || String(e)}`);
    }
  },
});
