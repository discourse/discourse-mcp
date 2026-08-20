import { defineTool } from "../../definition.js";
import { jsonResponse, jsonError, isZodError, zodError } from "../../../util/json_response.js";
import { deleteThemeSchema } from "./schemas.js";
import { unwrapTheme } from "./projections.js";
import { precondition, requireThemeWrite, themeMutation, themeMutationError, writeAnnotations } from "./common.js";

export const deleteThemeTool = defineTool({
  name: "discourse_delete_theme",
  title: "Delete Theme",
  description: "Permanently delete one non-system, non-default theme/component after a fresh exact-name check. Dependencies are not detached automatically and bulk deletion is not exposed.",
  schema: deleteThemeSchema,
  availability: "writes_enabled",
  toolsets: ["themes"],
  annotations: writeAnnotations(true, false),
  handler: async (input, _extra, ctx, opts) => {
    let attempted = false;
    try {
      const args = deleteThemeSchema.parse(input);
      const accessError = requireThemeWrite(ctx.siteState, opts);
      if (accessError) return accessError;
      const { base, client } = ctx.siteState.ensureSelectedSite();
      const current = unwrapTheme(await client.get(`/admin/themes/${args.theme_id}.json`));
      if (current.name !== args.expected_theme_name) return precondition("Theme name does not match expected_theme_name", { expected: args.expected_theme_name, actual: current.name ?? null });
      if (current.system === true || (typeof current.id === "number" && current.id < 0)) return jsonError("System themes cannot be deleted");
      if (current.default === true) return jsonError("The current default theme cannot be deleted; change the default first");
      attempted = true;
      await themeMutation(base, () => client.deleteNoRetry(`/admin/themes/${args.theme_id}.json`));
      return jsonResponse({ deleted: true, theme_id: args.theme_id, name: args.expected_theme_name });
    } catch (error) {
      if (isZodError(error)) return zodError(error);
      return themeMutationError("Failed to delete theme", error, attempted);
    }
  },
});
