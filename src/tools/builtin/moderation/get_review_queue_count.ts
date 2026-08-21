import { z } from "zod";
import { defineTool } from "../../definition.js";
import { requireAuthenticatedAccess } from "../../../util/access.js";
import { jsonResponse } from "../../../util/json_response.js";
import { moderationError, moderationRead } from "./common.js";

export const getReviewQueueCountTool = defineTool({
  name: "discourse_get_review_queue_count",
  title: "Get Review Queue Count",
  description: "Get the authoritative count of pending reviewable records visible to the authenticated user. This counts queue items, not individual flag/score records; upstream Guardian permissions remain authoritative.",
  schema: z.object({}).strict(),
  availability: "always",
  toolsets: ["moderation"],
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  handler: async (_input, _extra, ctx, _opts) => {
    const accessError = requireAuthenticatedAccess(ctx.siteState);
    if (accessError) return accessError;
    try {
      const { base, client } = ctx.siteState.ensureSelectedSite();
      const data = await moderationRead(base, () => client.get("/review/count.json")) as any;
      return jsonResponse({
        count: typeof data === "number" ? data : (data?.count ?? null),
        unit: "pending_reviewable_queue_items",
        status: "pending",
        scope: "visible_to_authenticated_user",
      });
    } catch (error) {
      return moderationError("get review queue count", error);
    }
  },
});
