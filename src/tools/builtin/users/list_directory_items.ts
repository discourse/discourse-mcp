import { z } from "zod";
import { defineTool } from "../../definition.js";
import { jsonResponse, withRateLimit } from "../../../util/json_response.js";
import { projectSlimUser } from "../common/post_projection.js";
import { readAnnotations, upstreamError } from "../common/helpers.js";

const schema = z.object({
  period: z.enum(["daily", "weekly", "monthly", "quarterly", "yearly", "all"]),
  order: z.string().regex(/^[a-z0-9_]+$/).optional(),
  ascending: z.boolean().optional(),
  group: z.string().min(1).optional(),
  page: z.number().int().min(0).max(10).optional(),
  limit: z.number().int().min(1).max(50).optional(),
  name: z.string().optional(),
  username: z.string().optional(),
  exclude_groups: z.array(z.string().min(1)).max(50).optional(),
  exclude_usernames: z.array(z.string().min(1)).max(100).optional(),
});

export const listDirectoryItemsTool = defineTool({
  name: "discourse_list_directory_items",
  title: "List Directory Items",
  description: "List user-directory/cohort metrics with authoritative totals and continuation. Supports Discourse periods, ordering, visible groups, page 0-10, and the upstream maximum of 50 rows.",
  schema,
  availability: "always",
  toolsets: ["activity"],
  annotations: readAnnotations(),
  handler: async ({ period, order, ascending, group, page = 0, limit = 50, name, username, exclude_groups, exclude_usernames }, _extra, ctx) => {
    try {
      const { base, client } = ctx.siteState.ensureSelectedSite();
      const query = new URLSearchParams({ period, page: String(page), limit: String(limit) });
      if (order) query.set("order", order);
      if (ascending === true) query.set("asc", "true");
      if (group) query.set("group", group);
      if (name) query.set("name", name);
      if (username) query.set("username", username);
      if (exclude_groups?.length) query.set("exclude_groups", exclude_groups.join("|"));
      if (exclude_usernames?.length) query.set("exclude_usernames", exclude_usernames.join(","));
      const data = await withRateLimit(`discourse-api:${base}`, () => client.get(`/directory_items.json?${query.toString()}`), 200) as any;
      const rows = (Array.isArray(data?.directory_items) ? data.directory_items : []).map((item: any) => ({
        id: item?.id ?? item?.user?.id ?? null,
        user: projectSlimUser(item?.user),
        likes_received: item?.likes_received ?? null,
        likes_given: item?.likes_given ?? null,
        topics_entered: item?.topics_entered ?? null,
        days_visited: item?.days_visited ?? null,
        posts_read: item?.posts_read ?? null,
        topic_count: item?.topic_count ?? null,
        post_count: item?.post_count ?? null,
        time_read: item?.time_read ?? null,
      }));
      const meta = data?.meta ?? {};
      return jsonResponse({ directory_items: rows, meta: { page, limit, returned: rows.length, total: meta?.total_rows_directory_items ?? null, has_more: Boolean(meta?.load_more_directory_items), next_page: meta?.load_more_directory_items ? page + 1 : null, last_updated_at: meta?.last_updated_at ?? null } });
    } catch (error) {
      return upstreamError("Failed to list directory items", error);
    }
  },
});
