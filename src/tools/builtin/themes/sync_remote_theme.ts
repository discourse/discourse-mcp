import { defineTool } from "../../definition.js";
import { jsonResponse, jsonError, isZodError, zodError } from "../../../util/json_response.js";
import { syncRemoteThemeSchema } from "./schemas.js";
import { detailedTheme, unwrapTheme } from "./projections.js";
import { precondition, requireThemeWrite, themeMutation, themeMutationError, writeAnnotations } from "./common.js";

function remote(theme: Record<string, unknown>): Record<string, unknown> | null {
  const value = theme.remote_theme;
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : null;
}

export const syncRemoteThemeTool = defineTool({
  name: "discourse_sync_remote_theme",
  title: "Sync Remote Theme",
  description: "Check or install updates for an existing Git-backed theme. Both actions clone external code and persist state; update deploys code and runs settings migrations, requiring explicit confirmations.",
  schema: syncRemoteThemeSchema,
  availability: "writes_enabled",
  toolsets: ["themes"],
  annotations: writeAnnotations(true, false),
  handler: async (input, _extra, ctx, opts) => {
    let attempted = false;
    try {
      const args = syncRemoteThemeSchema.parse(input);
      const accessError = requireThemeWrite(ctx.siteState, opts);
      if (accessError) return accessError;
      if (args.action === "update" && (args.confirm_external_code !== true || args.confirm_run_migrations !== true)) {
        return jsonError("Remote update requires confirm_external_code=true and confirm_run_migrations=true");
      }
      const { base, client } = ctx.siteState.ensureSelectedSite();
      const beforeResponse = await client.get(`/admin/themes/${args.theme_id}.json`);
      const beforeTheme = unwrapTheme(beforeResponse);
      const before = remote(beforeTheme);
      if (!before || (before["is_git?"] !== true && before.is_git !== true)) return jsonError("Theme is not backed by a Git repository");
      if (args.expected_remote_url !== undefined && before.remote_url !== args.expected_remote_url) return precondition("Remote URL does not match expected_remote_url");
      const key = args.action === "check" ? "remote_check" : "remote_update";
      attempted = true;
      const response = await themeMutation(base, () => client.putNoRetry(`/admin/themes/${args.theme_id}.json`, { theme: { [key]: true } }));
      const afterTheme = unwrapTheme(response);
      const after = remote(afterTheme);
      const checkEvidence = after && ["remote_version", "commits_behind", "remote_updated_at", "last_error_text"].some((field) => after[field] !== before[field]);
      const updateEvidence = after && (after.local_version !== before.local_version || (before.local_version !== before.remote_version && after.local_version === after.remote_version));
      return jsonResponse({
        action: args.action,
        checked: args.action === "check" ? (checkEvidence || null) : null,
        updated: args.action === "update" ? (updateEvidence || null) : null,
        before: detailedTheme(beforeResponse, false).remote,
        after: detailedTheme(response, false).remote,
        theme: detailedTheme(response, false),
        code_safety_validated: false,
      });
    } catch (error) {
      if (isZodError(error)) return zodError(error);
      return themeMutationError("Failed to sync remote theme", error, attempted);
    }
  },
});
