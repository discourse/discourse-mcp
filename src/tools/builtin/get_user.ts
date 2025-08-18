import { z } from "zod";
import type { RegisterFn } from "../types.js";

export const registerGetUser: RegisterFn = (server, ctx) => {
  const schema = z.object({
    username: z.string().min(1),
  });

  server.registerTool(
    "discourse.get_user",
    {
      title: "Get User",
      description: "Get basic user info.",
      inputSchema: schema.shape,
    },
    async ({ username }, _extra: any) => {
      try {
        const data = (await ctx.client.get(`/u/${encodeURIComponent(username)}.json`)) as any;
        const user = data?.user || data?.user_badges || data;
        const name = user?.name || username;
        const trust = user?.trust_level;
        const created = user?.created_at || user?.user?.created_at || "";
        const bio = user?.bio_raw || "";
        const lines = [
          `@${username} (${name})`,
          trust != null ? `Trust level: ${trust}` : undefined,
          created ? `Joined: ${created}` : undefined,
          bio ? "" : undefined,
          bio ? bio.slice(0, 1000) : undefined,
          `Profile: ${ctx.siteBase}/u/${encodeURIComponent(username)}`,
        ].filter(Boolean) as string[];
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Failed to get user ${username}: ${e?.message || String(e)}` }], isError: true };
      }
    }
  );
};

