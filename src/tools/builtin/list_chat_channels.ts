import type { RegisterFn } from "../types.js";
import { z } from "zod";

export const registerListChatChannels: RegisterFn = (server, ctx) => {
  const schema = z.object({
    filter: z.string().optional().describe("Filter channels by name/slug"),
    limit: z.number().int().min(1).max(100).optional().describe("Number of channels to return (default: 25, max: 100)"),
    offset: z.number().int().min(0).optional().describe("Pagination offset (default: 0)"),
    status: z.string().optional().describe("Filter by channel status (e.g., 'open', 'closed', 'archived')"),
  }).strict();

  server.registerTool(
    "discourse_list_chat_channels",
    {
      title: "List Chat Channels",
      description: "List all public chat channels visible to the current user. Returns channel information including title, description, and member counts.",
      inputSchema: schema.shape,
    },
    async ({ filter, limit = 25, offset = 0, status }, _extra: any) => {
      try {
        const { base, client } = ctx.siteState.ensureSelectedSite();

        // Build query parameters
        const params = new URLSearchParams();
        if (filter) params.append("filter", filter);
        params.append("limit", String(limit));
        params.append("offset", String(offset));
        if (status) params.append("status", status);

        const url = `/chat/api/channels?${params.toString()}`;
        const data = (await client.get(url)) as any;

        const channels: any[] = data?.channels || [];

        if (channels.length === 0) {
          return { content: [{ type: "text", text: "No chat channels found." }] };
        }

        const lines: string[] = [];
        lines.push(`# Chat Channels (${channels.length} shown)`);
        lines.push("");

        for (const channel of channels) {
          const title = channel.title || `Channel ${channel.id}`;
          const slug = channel.slug || String(channel.id);
          const description = channel.description || "";
          const membersCount = channel.memberships_count || 0;
          const statusText = channel.status || "open";

          lines.push(`## ${title}`);
          lines.push(`- **ID**: ${channel.id}`);
          lines.push(`- **Slug**: ${slug}`);
          lines.push(`- **Status**: ${statusText}`);
          lines.push(`- **Members**: ${membersCount}`);
          if (description) {
            lines.push(`- **Description**: ${description}`);
          }
          lines.push(`- **URL**: ${base}/chat/c/${slug}/${channel.id}`);
          lines.push("");
        }

        // Add pagination info
        if (data?.meta?.load_more_url) {
          lines.push(`_More channels available. Use offset=${offset + limit} to load next page._`);
        }

        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (e: any) {
        return {
          content: [{ type: "text", text: `Failed to list chat channels: ${e?.message || String(e)}` }],
          isError: true
        };
      }
    }
  );
};
