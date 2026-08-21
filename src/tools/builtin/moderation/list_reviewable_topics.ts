import { z } from "zod";
import { defineTool } from "../../definition.js";
import { requireAuthenticatedAccess } from "../../../util/access.js";
import { jsonResponse } from "../../../util/json_response.js";
import { projectTopic } from "../filter_topics.js";
import { moderationError, moderationRead } from "./common.js";

export const listReviewableTopicsTool = defineTool({
  name: "discourse_list_reviewable_topics",
  title: "List Reviewable Topics",
  description: "Non-exhaustive topic-level signal only: list pending topics at or above Discourse's minimum review priority. Do not use this tool to work through or rank the full queue because it omits reviewable IDs, actions, low-priority items, and items without topics. Use discourse_list_reviewables for moderation triage.",
  schema: z.object({}).strict(),
  availability: "always",
  toolsets: ["moderation"],
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  handler: async (_input, _extra, ctx, _opts) => {
    const accessError = requireAuthenticatedAccess(ctx.siteState);
    if (accessError) return accessError;
    try {
      const { base, client } = ctx.siteState.ensureSelectedSite();
      const data = await moderationRead(base, () => client.get("/review/topics.json")) as any;
      const source = Array.isArray(data?.reviewable_topics) ? data.reviewable_topics : Array.isArray(data?.topics) ? data.topics : Array.isArray(data) ? data : [];
      const topics = source.map((record: any) => {
        const topic = record?.topic ?? record;
        return {
          ...projectTopic(topic),
          score_count: record?.score_count ?? record?.flag_count ?? record?.count ?? record?.stats?.count ?? null,
          unique_flagger_count: record?.unique_flagger_count ?? record?.flagger_count ?? record?.unique_users ?? record?.stats?.unique_users ?? null,
          reviewable_score: record?.reviewable_score ?? null,
          claimed_by_id: record?.claimed_by_id ?? topic?.claimed_by_id ?? null,
          claimed_by: record?.claimed_by ?? topic?.claimed_by ?? null,
        };
      });
      return jsonResponse({
        topics,
        meta: {
          exhaustive: false,
          scope: "pending topics at or above Discourse's minimum review priority",
          count_field: "score_count counts review score/flag records, not reviewable queue items",
        },
      });
    } catch (error) {
      return moderationError("list reviewable topics", error);
    }
  },
});
