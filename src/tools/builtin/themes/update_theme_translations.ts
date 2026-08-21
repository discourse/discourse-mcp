import { defineTool } from "../../definition.js";
import { jsonResponse, jsonError, isZodError, zodError } from "../../../util/json_response.js";
import { updateThemeTranslationsSchema } from "./schemas.js";
import { unwrapTheme } from "./projections.js";
import { precondition, requireThemeWrite, themeMutation, themeMutationError, writeAnnotations } from "./common.js";

function translationMap(payload: unknown): Record<string, unknown> {
  const rows = payload && typeof payload === "object" && Array.isArray((payload as any).translations) ? (payload as any).translations : [];
  return Object.fromEntries(rows.filter((row: any) => typeof row?.key === "string").map((row: any) => [row.key, row.value]));
}

export const updateThemeTranslationsTool = defineTool({
  name: "discourse_update_theme_translations",
  title: "Update Theme Translations",
  description: "Replace values for explicit translation keys declared by a theme, after a fresh locale read. Unknown keys are rejected; deletion/revert is not supported in this release.",
  schema: updateThemeTranslationsSchema,
  availability: "writes_enabled",
  toolsets: ["themes"],
  annotations: writeAnnotations(true, true),
  handler: async (input, _extra, ctx, opts) => {
    let attempted = false;
    try {
      const args = updateThemeTranslationsSchema.parse(input);
      const accessError = requireThemeWrite(ctx.siteState, opts);
      if (accessError) return accessError;
      const { base, client } = ctx.siteState.ensureSelectedSite();
      const theme = unwrapTheme(await client.get(`/admin/themes/${args.theme_id}.json`));
      if (theme.name !== args.expected_theme_name) return precondition("Theme name does not match expected_theme_name", { expected: args.expected_theme_name, actual: theme.name ?? null });
      const currentResponse = await client.get(`/admin/themes/${args.theme_id}/translations/${encodeURIComponent(args.locale)}.json`);
      const beforeAll = translationMap(currentResponse);
      const requestedKeys = Object.keys(args.translations);
      const unknown = requestedKeys.filter((key) => !Object.prototype.hasOwnProperty.call(beforeAll, key));
      if (unknown.length) return jsonError("Translations contain keys not declared by the theme", { code: "invalid_parameters", unknown_keys: unknown });
      attempted = true;
      const response = await themeMutation(base, () => client.put(`/admin/themes/${args.theme_id}.json`, { theme: { locale: args.locale, translations: args.translations } }));
      const responseMap = translationMap(unwrapTheme(response));
      const before = Object.fromEntries(requestedKeys.map((key) => [key, beforeAll[key] ?? null]));
      const after = Object.fromEntries(requestedKeys.map((key) => [key, Object.prototype.hasOwnProperty.call(responseMap, key) ? responseMap[key] : null]));
      const applied = Object.fromEntries(requestedKeys.map((key) => [key, Object.prototype.hasOwnProperty.call(responseMap, key) ? responseMap[key] === args.translations[key] : null]));
      return jsonResponse({ updated: true, locale: args.locale, before, after, applied });
    } catch (error) {
      if (isZodError(error)) return zodError(error);
      return themeMutationError("Failed to update theme translations", error, attempted);
    }
  },
});
