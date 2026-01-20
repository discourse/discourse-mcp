import { z } from "zod";
import type { RegisterFn } from "../types.js";
import { jsonResponse, jsonError, paginatedResponse } from "../../util/json_response.js";

// Discourse admin API returns ~100 users per page (fixed by the API)
const DISCOURSE_PAGE_SIZE = 100;

export const registerListUsers: RegisterFn = (server, ctx) => {
  const schema = z.object({
    query: z.enum(["active", "new", "staff", "suspended", "silenced", "pending", "staged"])
      .optional()
      .default("active")
      .describe("User query type"),
    filter: z.string().optional().describe("Search by username, email, or IP address"),
    order: z.enum(["created", "last_emailed", "seen", "username", "trust_level", "days_visited", "posts"])
      .optional()
      .describe("Sort order field"),
    asc: z.boolean().optional().default(false).describe("Sort ascending (default: false/descending)"),
    page: z.number().int().min(0).optional().describe("Page number (0-indexed)"),
  });

  server.registerTool(
    "discourse_list_users",
    {
      title: "List Users",
      description: "List users via admin API. Requires admin API key. Returns ~100 users per page (Discourse's fixed page size). Returns JSON with users array and pagination meta.",
      inputSchema: schema.shape,
    },
    async (args, _extra) => {
      try {
        const { client } = ctx.siteState.ensureSelectedSite();

        const query = args.query || "active";
        // Discourse uses 1-indexed pages internally
        const discoursePage = (args.page ?? 0) + 1;

        // Build query parameters
        const params = new URLSearchParams();
        params.set("page", String(discoursePage));
        if (args.filter) params.set("filter", args.filter);
        if (args.order) params.set("order", args.order);
        if (args.asc) params.set("asc", "true");

        const data = (await client.get(
          `/admin/users/list/${query}.json?${params.toString()}`
        )) as any[];

        // Discourse returns array directly for admin user list
        const users = (data || []).map((user: any) => ({
          id: user.id,
          username: user.username,
          name: user.name || null,
          email: user.email || null,
          avatar_template: user.avatar_template || null,
          trust_level: user.trust_level ?? 0,
          created_at: user.created_at || null,
          last_seen_at: user.last_seen_at || null,
          admin: user.admin ?? false,
          moderator: user.moderator ?? false,
          suspended: user.suspended ?? false,
          silenced: user.silenced ?? false,
        }));

        return jsonResponse(paginatedResponse("users", users, {
          page: args.page ?? 0,
          limit: DISCOURSE_PAGE_SIZE,
          // has_more if we got a full page (likely more results exist)
          has_more: (data || []).length >= DISCOURSE_PAGE_SIZE,
        }));
      } catch (e: any) {
        return jsonError(`Failed to list users: ${e?.message || String(e)}`);
      }
    }
  );
};
