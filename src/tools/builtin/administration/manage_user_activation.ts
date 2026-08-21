import { z } from "zod";
import { defineTool } from "../../definition.js";
import { requireAdminAccess, requireWriteAccess } from "../../../util/access.js";
import { jsonError, jsonResponse, withRateLimit } from "../../../util/json_response.js";
import { mutationError } from "../common/helpers.js";

const schema = z.object({
  username: z.string().min(1),
  action: z.enum(["activate", "approve", "activate_and_approve", "deactivate"]),
  confirm: z.literal(true).describe("Must be true because this changes account access state"),
});

export const manageUserActivationTool = defineTool({
  name: "discourse_manage_user_activation",
  title: "Manage User Activation",
  description: "Activate, approve, activate-and-approve, or deactivate one user through Discourse's authoritative admin routes. Requires explicit confirmation and upstream staff authorization.",
  schema,
  availability: "writes_enabled",
  toolsets: ["administration"],
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  handler: async ({ username, action, confirm }, _extra, ctx, opts) => {
    if (confirm !== true) return jsonError("confirm must be true");
    const writeError = requireWriteAccess(ctx.siteState, opts.allowWrites);
    if (writeError) return writeError;
    const accessError = requireAdminAccess(ctx.siteState);
    if (accessError) return accessError;

    try {
      const { base, client } = ctx.siteState.ensureSelectedSite();
      const actions = action === "activate_and_approve" ? ["activate", "approve"] : [action];
      await withRateLimit(`administration:${base}`, async () => {
        for (const operation of actions) {
          await client.put(`/admin/users/${encodeURIComponent(username)}/${operation}.json`, {});
        }
      });
      return jsonResponse({ username, requested_action: action, completed_actions: actions, success: true });
    } catch (error) {
      return mutationError(`Failed to ${action.replace(/_/g, " ")} user ${username}`, error);
    }
  },
});
