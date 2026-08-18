import { z } from "zod";
import { defineTool } from "../../definition.js";
import { requireAuthenticatedAccess } from "../../../util/access.js";
import { jsonResponse, zodError } from "../../../util/json_response.js";
import { moderationError, moderationRead, normalizeReviewable, normalizeSideLoads } from "./common.js";

function optionalText(description: string) {
  return z.preprocess(
    (value) => {
      if (typeof value !== "string") return value;
      const normalized = value.trim().toLowerCase();
      return normalized === "" || normalized === "all" || normalized === "any" ? undefined : value;
    },
    z.string().optional(),
  ).describe(description);
}

const schema = z.object({
  offset: z.number().int().min(0).optional().describe("Queue offset; start at 0 and follow meta.next_offset"),
  status: z.enum(["pending", "approved", "rejected", "ignored", "deleted", "all"]).optional().default("pending")
    .describe("Reviewable status; defaults to pending"),
  type: optionalText("Exact reviewable class such as ReviewableFlaggedPost; blank/all/any means no type filter"),
  topic_id: z.number().int().min(0).optional().describe("Exact topic ID; omit or use 0 for no topic filter"),
  category_id: z.number().int().min(0).optional().describe("Exact category ID; omit or use 0 for no category filter"),
  priority: optionalText("Exact upstream priority filter; omit or pass blank for all priorities"),
  username: optionalText("Target username filter; omit or pass blank for all users"),
  reviewed_by: optionalText("Reviewer username; omit or pass blank for all reviewers"),
  claimed_by: optionalText("Claiming moderator username; omit or pass blank for all claim states"),
  flagged_by: optionalText("Flagger username; omit or pass blank for all flaggers"),
  from_date: optionalText("Inclusive ISO date/time lower bound; omit or pass blank for no lower bound"),
  to_date: optionalText("Inclusive ISO date/time upper bound; omit or pass blank for no upper bound"),
  sort_order: optionalText("Exact upstream queue sort order; omit or pass blank for Discourse's default"),
  score_type: optionalText("Exact upstream score type; omit or pass blank for all score types"),
}).strict();

export const listReviewablesTool = defineTool({
  name: "discourse_list_reviewables",
  title: "List Reviewables",
  description: "Work through the exhaustive visible Discourse queue in pages of 10. For ordinary triage, call with only status=pending and offset=0—do not guess topic/category/type filters. Use meta.total and follow next_offset while has_more is true. Each result already includes bounded evidence and exact dynamic actions; fetch detail only for a shortlisted item that needs fresher context.",
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
      const offset = parsed.data.offset ?? 0;
      const params = new URLSearchParams();
      params.set("offset", String(offset));
      for (const [key, value] of Object.entries(parsed.data)) {
        if (key === "offset" || value === undefined) continue;
        if ((key === "topic_id" || key === "category_id") && value === 0) continue;
        params.set(key, String(value));
      }
      const { base, client } = ctx.siteState.ensureSelectedSite();
      const data = await moderationRead(base, () => client.get(`/review.json?${params.toString()}`)) as any;
      const raw = Array.isArray(data?.reviewables) ? data.reviewables : [];
      const reviewables = raw.map((item: any) => normalizeReviewable(item, data));
      const totalCandidate = data?.meta?.total_rows_reviewables ?? data?.meta?.total ?? data?.total;
      const total = typeof totalCandidate === "number" ? totalCandidate : undefined;
      const explicitMore = data?.meta?.has_more ?? data?.has_more;
      const continuation = data?.meta?.load_more_reviewables ?? data?.more_reviewables_url;
      const hasMore = typeof explicitMore === "boolean"
        ? explicitMore
        : Boolean(continuation) || (total !== undefined ? offset + reviewables.length < total : false);
      const meta: Record<string, unknown> = {
        offset,
        per_page: 10,
        returned: reviewables.length,
        has_more: hasMore,
        next_offset: hasMore ? offset + 10 : null,
        scope: "visible_to_authenticated_user",
        status: parsed.data.status,
      };
      if (total !== undefined) meta.total = total;
      return jsonResponse({ reviewables, ...normalizeSideLoads(data), meta });
    } catch (error) {
      return moderationError("list reviewables", error);
    }
  },
});
