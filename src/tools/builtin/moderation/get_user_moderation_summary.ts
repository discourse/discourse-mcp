import { z } from "zod";
import { defineTool } from "../../definition.js";
import { requireAuthenticatedAccess } from "../../../util/access.js";
import { jsonResponse, withRateLimit } from "../../../util/json_response.js";
import { readAnnotations, upstreamError } from "../common/helpers.js";

const schema = z.object({ username: z.string().min(1) });

export const getUserModerationSummaryTool = defineTool({
  name: "discourse_get_user_moderation_summary",
  title: "Get User Moderation Summary",
  description: "Get staff-authorized behavioral moderation counters for a user. Omits unrelated administrative capability flags; Discourse permissions remain authoritative.",
  schema,
  availability: "always",
  toolsets: ["moderation"],
  annotations: readAnnotations(),
  handler: async ({ username }, _extra, ctx) => {
    const accessError = requireAuthenticatedAccess(ctx.siteState);
    if (accessError) return accessError;
    try {
      const { base, client } = ctx.siteState.ensureSelectedSite();
      const data = await withRateLimit(`discourse-api:${base}`, () => client.get(`/u/${encodeURIComponent(username)}/staff-info.json`), 200) as any;
      return jsonResponse({
        username,
        deleted_posts: data?.number_of_deleted_posts ?? null,
        flags_received: data?.number_of_flags ?? null,
        flags_given: data?.number_of_flags_given ?? null,
        silencings: data?.number_of_silencings ?? null,
        suspensions: data?.number_of_suspensions ?? null,
        warnings_received: data?.warnings_received_count ?? null,
        rejected_posts: data?.number_of_rejected_posts ?? null,
      });
    } catch (error) {
      return upstreamError(`Failed to get moderation summary for ${username}`, error);
    }
  },
});
