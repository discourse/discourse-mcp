import { defineTool } from "../../definition.js";
import { jsonResponse, jsonError, isZodError, zodError } from "../../../util/json_response.js";
import { updateThemeSchema } from "./schemas.js";
import { slimTheme, unwrapTheme, summariesEqual } from "./projections.js";
import { componentFlag, precondition, requireThemeWrite, themeMutation, themeMutationError, writeAnnotations } from "./common.js";

const MUTATION_KEYS = ["name", "color_scheme_id", "dark_color_scheme_id", "user_selectable", "auto_update", "enabled", "parent_theme_ids", "child_theme_ids", "set_default"] as const;

function relationIds(theme: Record<string, unknown>, key: "parent_themes" | "child_themes") {
  return Array.isArray(theme[key]) ? (theme[key] as any[]).map((row) => row?.id).filter((id) => typeof id === "number") : undefined;
}

export const updateThemeTool = defineTool({
  name: "discourse_update_theme",
  title: "Update Theme Metadata",
  description: "Update bounded metadata, default status, or complete theme-component relationships. Relationship arrays replace the entire graph side; source, settings, translations, and remote refresh are intentionally excluded.",
  schema: updateThemeSchema,
  availability: "writes_enabled",
  toolsets: ["themes"],
  annotations: writeAnnotations(true, true),
  handler: async (input, _extra, ctx, opts) => {
    let attempted = false;
    try {
      const args = updateThemeSchema.parse(input);
      const accessError = requireThemeWrite(ctx.siteState, opts);
      if (accessError) return accessError;
      const keys = MUTATION_KEYS.filter((key) => args[key] !== undefined);
      if (!keys.length) return jsonError("At least one metadata mutation is required");
      if (args.set_default !== undefined && args.confirm_default_change !== true) return jsonError("confirm_default_change=true is required when setting or clearing the default");
      if ((args.parent_theme_ids !== undefined || args.child_theme_ids !== undefined) && args.confirm_component_graph_replace !== true) return jsonError("confirm_component_graph_replace=true is required because relationship arrays are complete replacements");
      const { base, client } = ctx.siteState.ensureSelectedSite();
      const beforeResponse = await client.get(`/admin/themes/${args.theme_id}.json`);
      const before = unwrapTheme(beforeResponse);
      if (args.expected_name !== undefined && before.name !== args.expected_name) return precondition("Theme name does not match expected_name", { expected: args.expected_name, actual: before.name ?? null });
      const component = componentFlag(before);
      if (component === true && (args.set_default !== undefined || args.user_selectable !== undefined || args.color_scheme_id !== undefined || args.dark_color_scheme_id !== undefined || args.child_theme_ids !== undefined)) {
        return jsonError("Components cannot be default, user-selectable, own color schemes, or have child components");
      }
      if (component === false && (args.enabled !== undefined || args.parent_theme_ids !== undefined)) return jsonError("enabled and parent_theme_ids are component-only inputs");
      if (before.system === true || args.theme_id < 0) {
        const forbidden = keys.filter((key) => !["color_scheme_id", "dark_color_scheme_id", "user_selectable", "child_theme_ids", "set_default"].includes(key));
        if (forbidden.length) return jsonError(`System themes cannot update: ${forbidden.join(", ")}`, { code: "invalid_parameters" });
      }
      const theme: Record<string, unknown> = {};
      for (const key of keys) theme[key === "set_default" ? "default" : key] = args[key];
      attempted = true;
      const response = await themeMutation(base, () => client.put(`/admin/themes/${args.theme_id}.json`, { theme }));
      const after = unwrapTheme(response);
      const applied: Record<string, boolean | null> = {};
      for (const key of keys) {
        const actual = key === "set_default" ? after.default
          : key === "parent_theme_ids" ? relationIds(after, "parent_themes")
          : key === "child_theme_ids" ? relationIds(after, "child_themes")
          : after[key];
        applied[key] = summariesEqual(actual, args[key]);
      }
      return jsonResponse({ updated: true, before: slimTheme(beforeResponse), after: slimTheme(response), applied });
    } catch (error) {
      if (isZodError(error)) return zodError(error);
      return themeMutationError("Failed to update theme metadata", error, attempted);
    }
  },
});
