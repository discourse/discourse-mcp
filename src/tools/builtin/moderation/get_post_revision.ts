import { z } from "zod";
import { defineTool } from "../../definition.js";
import { requireAuthenticatedAccess } from "../../../util/access.js";
import { jsonResponse, withRateLimit } from "../../../util/json_response.js";
import { bounded, readAnnotations, upstreamError } from "../common/helpers.js";

const schema = z.object({ post_id: z.number().int().positive(), revision: z.union([z.literal("latest"), z.number().int().positive()]).optional() });

function boundChange(value: unknown, limit: number): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return bounded(value, limit);
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, typeof item === "object" && item !== null ? bounded(JSON.stringify(item), limit) : bounded(item, limit)]));
}

export const getPostRevisionTool = defineTool({
  name: "discourse_get_post_revision",
  title: "Get Post Revision",
  description: "Get a staff/Guardian-authorized post revision with bounded diffs, edit reason, actor, version, and hidden-state evidence.",
  schema,
  availability: "always",
  toolsets: ["moderation"],
  annotations: readAnnotations(),
  handler: async ({ post_id, revision = "latest" }, _extra, ctx) => {
    const accessError = requireAuthenticatedAccess(ctx.siteState);
    if (accessError) return accessError;
    try {
      const { base, client } = ctx.siteState.ensureSelectedSite();
      const data = await withRateLimit(`discourse-api:${base}`, () => client.get(`/posts/${post_id}/revisions/${revision}.json`), 200) as any;
      const result: Record<string, unknown> = {
        post_id,
        revision: data?.current_revision ?? data?.version ?? revision,
        previous_revision: data?.previous_revision ?? null,
        next_revision: data?.next_revision ?? null,
        created_at: data?.created_at ?? null,
        edit_reason: bounded(data?.edit_reason, ctx.maxReadLength),
        actor: { username: data?.display_username ?? data?.username ?? null, name: data?.acting_user_name ?? null, avatar_template: data?.avatar_template ?? null },
        previous_hidden: data?.previous_hidden ?? null,
        current_hidden: data?.current_hidden ?? null,
        current_version: data?.current_version ?? null,
        version_count: data?.version_count ?? null,
      };
      for (const key of ["body_changes", "title_changes", "user_changes", "reply_to_post_number_changes", "tags_changes", "category_id_changes", "wiki_changes", "post_type_changes", "locale_changes"] as const) {
        if (data?.[key] !== undefined) result[key] = boundChange(data[key], ctx.maxReadLength);
      }
      return jsonResponse(result);
    } catch (error) {
      return upstreamError(`Failed to get revision for post ${post_id}`, error);
    }
  },
});
