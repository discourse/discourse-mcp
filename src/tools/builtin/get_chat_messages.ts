import type { RegisterFn } from "../types.js";
import { z } from "zod";

export const registerGetChatMessages: RegisterFn = (server, ctx) => {
  const schema = z.object({
    channel_id: z.number().int().positive().describe("The chat channel ID"),
    page_size: z.number().int().min(1).max(500).optional().describe("Number of messages to return (default: 50, max: 500)"),
    target_message_id: z.number().int().positive().optional().describe("Message ID to query around or paginate from"),
    direction: z.enum(["past", "future"]).optional().describe("Pagination direction: 'past' for older messages (DESC), 'future' for newer messages (ASC)"),
    target_date: z.string().optional().describe("ISO 8601 date string (e.g., '2024-01-15' or '2024-01-15T10:30:00Z') to query messages around that date"),
    fetch_from_last_read: z.boolean().optional().describe("If true, start from the user's last read message"),
    include_target_message_id: z.boolean().optional().describe("Whether to include the target message in results (default: true)"),
  }).strict();

  server.registerTool(
    "discourse_get_chat_messages",
    {
      title: "Get Chat Messages",
      description: "Get messages from a chat channel with flexible pagination and date-based filtering. Supports: (1) paginating with direction='past'/'future' from a target_message_id, (2) querying messages around a specific target_date, (3) getting messages around a target_message_id, or (4) fetching from last read position.",
      inputSchema: schema.shape,
    },
    async ({
      channel_id,
      page_size = 50,
      target_message_id,
      direction,
      target_date,
      fetch_from_last_read,
      include_target_message_id
    }, _extra: any) => {
      try {
        const { base, client } = ctx.siteState.ensureSelectedSite();

        // Build query parameters
        const params = new URLSearchParams();
        params.append("page_size", String(page_size));

        if (target_message_id !== undefined) {
          params.append("target_message_id", String(target_message_id));
        }

        if (direction) {
          params.append("direction", direction);
        }

        if (target_date) {
          params.append("target_date", target_date);
        }

        if (fetch_from_last_read !== undefined) {
          params.append("fetch_from_last_read", String(fetch_from_last_read));
        }

        if (include_target_message_id !== undefined) {
          params.append("include_target_message_id", String(include_target_message_id));
        }

        const url = `/chat/api/channels/${channel_id}/messages?${params.toString()}`;
        const data = (await client.get(url)) as any;

        const messages: any[] = data?.messages || [];
        const meta = data?.meta || {};

        if (messages.length === 0) {
          return { content: [{ type: "text", text: "No messages found in this channel." }] };
        }

        const limit = Number.isFinite(ctx.maxReadLength) ? ctx.maxReadLength : 50000;
        const lines: string[] = [];

        // Header
        lines.push(`# Chat Messages (Channel ${channel_id})`);
        lines.push(`Showing ${messages.length} messages`);
        if (target_date) {
          lines.push(`Around date: ${target_date}`);
        }
        if (meta.target_message_id) {
          lines.push(`Target message ID: ${meta.target_message_id}`);
        }
        lines.push("");

        // Pagination info
        // Note: The API only sets flags for the direction you queried:
        // - direction='future': only can_load_more_future is meaningful
        // - direction='past': only can_load_more_past is meaningful
        // - no direction: defaults to latest messages, so can_load_more_past is meaningful
        const canLoadMorePast = meta.can_load_more_past ?? false;
        const canLoadMoreFuture = meta.can_load_more_future ?? false;
        const hints: string[] = [];

        // When querying in a specific direction, assume the opposite direction is available
        // unless we're at the absolute start/end of the channel
        if (direction === "future") {
          // Going forward in time (to newer messages)
          if (canLoadMoreFuture) {
            const newestId = messages[messages.length - 1]?.id;
            hints.push(`more messages available (use direction='future' with target_message_id=${newestId})`);
          } else {
            hints.push(`no more messages (reached end of channel)`);
          }
          // We came from somewhere, so there are likely older messages
          if (target_message_id) {
            hints.push(`to go back, use direction='past' with target_message_id=${messages[0]?.id}`);
          }
        } else if (direction === "past") {
          // Going backward in time (to older messages)
          if (canLoadMorePast) {
            const oldestId = messages[0]?.id;
            hints.push(`more messages available (use direction='past' with target_message_id=${oldestId})`);
          } else {
            hints.push(`no more messages (reached start of channel)`);
          }
          // We came from somewhere, so there are likely newer messages
          if (target_message_id) {
            hints.push(`to go forward, use direction='future' with target_message_id=${messages[messages.length - 1]?.id}`);
          }
        } else {
          // No direction specified = fetching latest messages
          if (canLoadMorePast) {
            const oldestId = messages[0]?.id;
            hints.push(`older messages available (use direction='past' with target_message_id=${oldestId})`);
          } else {
            hints.push(`no older messages (this is the entire channel history)`);
          }
          // At the latest, so no newer messages
          hints.push(`no newer messages (at end of channel)`);
        }

        if (hints.length > 0) {
          lines.push(`_Pagination: ${hints.join("; ")}_`);
          lines.push("");
        }

        // Messages
        for (const msg of messages) {
          const username = msg.user?.username || "unknown";
          const createdAt = msg.created_at || "unknown time";
          const messageText = (msg.message || msg.cooked || "").toString().slice(0, limit);
          const edited = msg.edited ? " (edited)" : "";
          const threadId = msg.thread_id ? ` [thread:${msg.thread_id}]` : "";
          const inReplyTo = msg.in_reply_to ? ` [reply to #${msg.in_reply_to.id}]` : "";

          lines.push(`## Message #${msg.id}${edited}`);
          lines.push(`**@${username}** at ${createdAt}${threadId}${inReplyTo}`);
          lines.push("");
          lines.push(messageText);
          lines.push("");

          // Reactions
          if (msg.reactions && msg.reactions.length > 0) {
            const reactionStr = msg.reactions
              .map((r: any) => `${r.emoji} ${r.count}`)
              .join(", ");
            lines.push(`_Reactions: ${reactionStr}_`);
            lines.push("");
          }

          // Uploads/attachments
          if (msg.uploads && msg.uploads.length > 0) {
            lines.push("_Attachments:_");
            for (const upload of msg.uploads) {
              lines.push(`- ${upload.original_filename || upload.url}`);
            }
            lines.push("");
          }

          // Mentioned users
          if (msg.mentioned_users && msg.mentioned_users.length > 0) {
            const mentions = msg.mentioned_users.map((u: any) => `@${u.username}`).join(", ");
            lines.push(`_Mentions: ${mentions}_`);
            lines.push("");
          }

          lines.push("---");
          lines.push("");
        }

        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (e: any) {
        return {
          content: [{ type: "text", text: `Failed to get chat messages: ${e?.message || String(e)}` }],
          isError: true
        };
      }
    }
  );
};
