import { z } from "zod";
import { defineTool } from "../../definition.js";
import { requireAuthenticatedAccess } from "../../../util/access.js";
import { jsonResponse, zodError } from "../../../util/json_response.js";
import { moderationError, moderationRead, normalizeReviewContext } from "./common.js";

const schema = z.object({
  reviewable_id: z.number().int().positive(),
  include_explanation: z.boolean().optional(),
}).strict();

export const getReviewableTool = defineTool({
  name: "discourse_get_reviewable",
  title: "Get Reviewable",
  description: "Refresh one shortlisted reviewable's bounded context, current version, claim state, scores, and exact dynamic actions. Paginated list results already include evidence/actions, so do not fan this tool out across the queue. Optionally includes Discourse's score explanation; never generates a recommendation.",
  schema,
  availability: "always",
  toolsets: ["moderation"],
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  handler: async (input, _extra, ctx, _opts) => {
    const parsed = schema.safeParse(input);
    if (!parsed.success) return zodError(parsed.error);
    const accessError = requireAuthenticatedAccess(ctx.siteState);
    if (accessError) return accessError;
    try {
      const { reviewable_id, include_explanation = false } = parsed.data;
      const { base, client } = ctx.siteState.ensureSelectedSite();
      const data = await moderationRead(base, () => client.get(`/review/${reviewable_id}.json`)) as any;
      const result: Record<string, unknown> = normalizeReviewContext(data);
      if (include_explanation) {
        result.explanation = await moderationRead(base, () => client.get(`/review/${reviewable_id}/explain.json`));
      }
      return jsonResponse(result);
    } catch (error) {
      return moderationError("get reviewable", error);
    }
  },
});
