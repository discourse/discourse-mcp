import { z } from "zod";
import { defineTool } from "../../definition.js";
import { jsonError, jsonResponse, withRateLimit } from "../../../util/json_response.js";
import { projectPost } from "../common/post_projection.js";
import { queryString, readAnnotations, upstreamError } from "../common/helpers.js";

const schema = z.object({
  group_name: z.string().min(1),
  before_post_id: z.number().int().positive().optional(),
  before: z.string().datetime({ offset: true }).optional(),
  category_id: z.number().int().positive().optional(),
});

export const listGroupPostsTool = defineTool({
  name: "discourse_list_group_posts",
  title: "List Group Posts",
  description: "List visible posts authored by a group using Discourse's fixed 20-row page, ID or timestamp cursor, and optional category filter. Group authorship is cohort evidence, not proof of organizational responsibility.",
  schema,
  availability: "always",
  toolsets: ["groups"],
  annotations: readAnnotations(),
  handler: async ({ group_name, before_post_id, before, category_id }, _extra, ctx) => {
    if (before_post_id !== undefined && before !== undefined) return jsonError("Choose only one group-post cursor", { code: "invalid_parameters" });
    try {
      const { base, client } = ctx.siteState.ensureSelectedSite();
      const path = `/groups/${encodeURIComponent(group_name)}/posts.json${queryString({ before_post_id, before, category_id })}`;
      const data = await withRateLimit(`discourse-api:${base}`, () => client.get(path), 200) as any;
      const upstream = Array.isArray(data?.posts) ? data.posts : [];
      return jsonResponse({
        posts: upstream.map((post: any) => projectPost(post, ctx.maxReadLength)),
        categories: Array.isArray(data?.categories) ? data.categories.map((c: any) => ({ id: c?.id ?? null, name: c?.name ?? null, slug: c?.slug ?? null })) : [],
        meta: { fixed_page_size: 20, returned: upstream.length, has_more: null, page_was_full: upstream.length === 20, next_before_post_id: upstream.length > 0 ? upstream.at(-1)?.id ?? null : null },
      });
    } catch (error) {
      return upstreamError(`Failed to list posts for group ${group_name}`, error);
    }
  },
});
