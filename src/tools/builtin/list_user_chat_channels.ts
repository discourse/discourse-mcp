import type { RegisterFn } from "../types.js";
import { z } from "zod";

export const registerListUserChatChannels: RegisterFn = (server, ctx) => {
  const schema = z.object({}).strict();

  server.registerTool(
    "discourse_list_user_chat_channels",
    {
      title: "List User's Chat Channels",
      description: "List all chat channels for the currently authenticated user, including both public channels they're a member of and direct message channels. Includes unread tracking information.",
      inputSchema: schema.shape,
    },
    async (_args, _extra: any) => {
      try {
        const { base, client } = ctx.siteState.ensureSelectedSite();

        const url = `/chat/api/me/channels`;
        const data = (await client.get(url)) as any;

        const publicChannels: any[] = data?.public_channels || [];
        const dmChannels: any[] = data?.direct_message_channels || [];
        const tracking = data?.tracking || {};

        const lines: string[] = [];
        lines.push("# My Chat Channels");
        lines.push("");

        // Public channels
        if (publicChannels.length > 0) {
          lines.push(`## Public Channels (${publicChannels.length})`);
          lines.push("");
          for (const channel of publicChannels) {
            const title = channel.title || `Channel ${channel.id}`;
            const slug = channel.slug || String(channel.id);
            const unreadCount = tracking?.channel_tracking?.[channel.id]?.unread_count || 0;
            const mentionCount = tracking?.channel_tracking?.[channel.id]?.mention_count || 0;

            lines.push(`### ${title}`);
            lines.push(`- **ID**: ${channel.id}`);
            lines.push(`- **Slug**: ${slug}`);
            lines.push(`- **Status**: ${channel.status || "open"}`);
            if (unreadCount > 0) {
              lines.push(`- **Unread**: ${unreadCount} messages`);
            }
            if (mentionCount > 0) {
              lines.push(`- **Mentions**: ${mentionCount}`);
            }
            if (channel.last_message) {
              const lastMsg = channel.last_message;
              lines.push(`- **Last Message**: by @${lastMsg.user?.username || "unknown"} at ${lastMsg.created_at || "unknown time"}`);
            }
            lines.push(`- **URL**: ${base}/chat/c/${slug}/${channel.id}`);
            lines.push("");
          }
        } else {
          lines.push("## Public Channels");
          lines.push("No public channels.");
          lines.push("");
        }

        // Direct message channels
        if (dmChannels.length > 0) {
          lines.push(`## Direct Messages (${dmChannels.length})`);
          lines.push("");
          for (const channel of dmChannels) {
            const title = channel.title || `DM ${channel.id}`;
            const unreadCount = tracking?.channel_tracking?.[channel.id]?.unread_count || 0;
            const mentionCount = tracking?.channel_tracking?.[channel.id]?.mention_count || 0;

            lines.push(`### ${title}`);
            lines.push(`- **ID**: ${channel.id}`);
            if (unreadCount > 0) {
              lines.push(`- **Unread**: ${unreadCount} messages`);
            }
            if (mentionCount > 0) {
              lines.push(`- **Mentions**: ${mentionCount}`);
            }
            if (channel.last_message) {
              const lastMsg = channel.last_message;
              lines.push(`- **Last Message**: by @${lastMsg.user?.username || "unknown"} at ${lastMsg.created_at || "unknown time"}`);
            }
            lines.push(`- **URL**: ${base}/chat/c/-/${channel.id}`);
            lines.push("");
          }
        } else {
          lines.push("## Direct Messages");
          lines.push("No direct message channels.");
          lines.push("");
        }

        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (e: any) {
        return {
          content: [{ type: "text", text: `Failed to list user chat channels: ${e?.message || String(e)}` }],
          isError: true
        };
      }
    }
  );
};
