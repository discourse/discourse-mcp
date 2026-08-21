import { z } from "zod";
import { defineTool } from "../../definition.js";
import { requireWriteAccess } from "../../../util/access.js";
import { jsonError, jsonResponse, withRateLimit, zodError } from "../../../util/json_response.js";
import {
  allowedActionFieldNames,
  availableActions,
  moderationError,
  normalizeReviewContext,
} from "./common.js";

const schema = z.object({
  reviewable_id: z.number().int().positive().describe("Reviewable ID from list/detail"),
  action_id: z.string().trim().min(1).describe("Exact available_actions[].id from the current reviewable; the MCP maps its server_action to the route"),
  expected_version: z.number().int().min(0).optional().describe("Version observed during review; fail closed if it has changed"),
  additional_fields: z.record(z.unknown()).optional().describe("Only fields advertised by the selected dynamic action contract"),
  confirm: z.literal(true).describe("Explicit acknowledgement that the selected action may delete content, delete users, or block accounts"),
}).strict();

export const performReviewableActionTool = defineTool({
  name: "discourse_perform_reviewable_action",
  title: "Perform Reviewable Action",
  description: "Perform one exact dynamic action after a fresh serialized preflight. Choose by the action's full description, not label alone (for example delete-and-agree differs from delete-and-ignore). The displayed action ID may be UI-prefixed; this tool safely routes its server_action. Requires confirm=true and write enablement.",
  schema,
  availability: "writes_enabled",
  toolsets: ["moderation"],
  annotations: { destructiveHint: true, readOnlyHint: false, idempotentHint: false, openWorldHint: true },
  handler: async (input, _extra, ctx, opts) => {
    const parsed = schema.safeParse(input);
    if (!parsed.success) return zodError(parsed.error);
    const accessError = requireWriteAccess(ctx.siteState, opts.allowWrites);
    if (accessError) return accessError;

    const { reviewable_id, action_id, expected_version, additional_fields = {} } = parsed.data;
    const { base, client } = ctx.siteState.ensureSelectedSite();
    return withRateLimit(`discourse-api:${base}`, async () => {
      let mutationAttempted = false;
      let performedAction: string | undefined;
      try {
        const fresh = await client.get(`/review/${reviewable_id}.json`) as any;
        const reviewable = fresh?.reviewable ?? (Array.isArray(fresh?.reviewables) ? fresh.reviewables[0] : fresh);
        const action = availableActions(reviewable, fresh).find((candidate) =>
          String(candidate.id) === action_id || String(candidate.server_action) === action_id,
        );
        if (!action) {
          return jsonError("Reviewable action is not currently available; refresh detail and use one exact available action ID", {
            reviewable_id,
            action_id,
          });
        }

        performedAction = typeof action.server_action === "string" && action.server_action
          ? action.server_action
          : String(action.id);
        const currentVersion = reviewable?.version;
        if (typeof currentVersion !== "number") {
          return jsonError("Fresh reviewable response did not include a usable version; action was not performed", { reviewable_id });
        }
        if (expected_version !== undefined && expected_version !== currentVersion) {
          return jsonError("Reviewable version changed; action was not performed", {
            reviewable_id,
            expected_version,
            current_version: currentVersion,
          });
        }

        const allowed = allowedActionFieldNames(action);
        if (action.require_reject_reason === true) allowed.add("reject_reason");
        const supplied = Object.keys(additional_fields);
        const disallowed = supplied.filter((name) => !allowed.has(name));
        if (disallowed.length > 0) {
          return jsonError("Additional fields are not allowed by the selected action contract", {
            reviewable_id,
            action_id,
            disallowed_fields: disallowed,
            allowed_fields: [...allowed],
          });
        }

        mutationAttempted = true;
        const result = await client.put(
          `/review/${reviewable_id}/perform/${encodeURIComponent(performedAction!)}.json`,
          { version: currentVersion, ...additional_fields },
        ) as any;
        const performResult = result?.reviewable_perform_result ?? result;
        return jsonResponse({
          success: performResult?.success ?? true,
          reviewable_id,
          requested_action_id: action_id,
          performed_action: performedAction,
          removed_reviewable_ids: performResult?.remove_reviewable_ids ?? [],
          version: performResult?.version ?? null,
          remaining_reviewable_count: performResult?.reviewable_count ?? null,
          unseen_reviewable_count: performResult?.unseen_reviewable_count ?? null,
          reviewable: result?.reviewable ? normalizeReviewContext(result).reviewable : null,
          upstream_result: performResult,
        });
      } catch (error) {
        return moderationError("perform reviewable action", error, {
          reviewable_id,
          action_id,
          performed_action: performedAction,
          mutation_attempted: mutationAttempted,
        });
      }
    }, 1000);
  },
});
