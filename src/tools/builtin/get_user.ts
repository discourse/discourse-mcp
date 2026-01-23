import { z } from "zod";
import type { RegisterFn } from "../types.js";
import { jsonResponse, jsonError } from "../../util/json_response.js";
import { requireAdminAccess } from "../../util/access.js";

export const registerGetUser: RegisterFn = (server, ctx, opts) => {
  const schema = z.object({
    username: z.string().min(1),
  });

  server.registerTool(
    "discourse_get_user",
    {
      title: "Get User",
      description: "Get user info. Returns JSON with id, username, name, trust_level, created_at, bio, admin, and moderator.",
      inputSchema: schema.shape,
    },
    async ({ username }, _extra) => {
      try {
        const { client } = ctx.siteState.ensureSelectedSite();
        const data = (await client.get(`/u/${encodeURIComponent(username)}.json`)) as any;
        const user = data?.user || data;

        const response = {
          id: user?.id,
          username: user?.username || username,
          name: user?.name || null,
          trust_level: user?.trust_level ?? null,
          created_at: user?.created_at || null,
          bio: user?.bio_raw ? user.bio_raw.slice(0, 500) : null,
          admin: user?.admin || false,
          moderator: user?.moderator || false,
          email: undefined
        }

        const hasAdminAccess = !requireAdminAccess(ctx.siteState);

        if (hasAdminAccess && opts.showEmails) {
          const emailData = (await client.get(`/u/${encodeURIComponent(username)}/emails.json`)) as any;
          response.email = emailData?.email || null;
        }


        return jsonResponse(response);
      } catch (e: any) {
        return jsonError(`Failed to get user ${username}: ${e?.message || String(e)}`);
      }
    }
  );
};

