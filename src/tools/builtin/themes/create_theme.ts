import { defineTool } from "../../definition.js";
import { jsonResponse, jsonError, isZodError, zodError } from "../../../util/json_response.js";
import { createThemeSchema, LIMITS } from "./schemas.js";
import { fieldPayload, detailedTheme, unwrapTheme } from "./projections.js";
import { requireThemeWrite, themeMutation, themeMutationError, writeAnnotations } from "./common.js";

export const createThemeTool = defineTool({
  name: "discourse_create_theme",
  title: "Create Theme",
  description: "Create a local Discourse theme or component. For textual HTML/SCSS/JS fields provide value and omit upload_id; for assets provide numeric upload_id with type=upload and omit value. Supplied code can execute or deploy for visitors; explicit confirmations and admin write access are required.",
  schema: createThemeSchema,
  availability: "writes_enabled",
  toolsets: ["themes"],
  annotations: writeAnnotations(false, false),
  handler: async (input, _extra, ctx, opts) => {
    try {
      const args = createThemeSchema.parse(input);
      const accessError = requireThemeWrite(ctx.siteState, opts);
      if (accessError) return accessError;
      if (args.component && (args.set_default !== undefined || args.user_selectable !== undefined || args.color_scheme_id !== undefined)) {
        return jsonError("Components cannot be default, user-selectable, or own a color scheme", { code: "invalid_parameters" });
      }
      if (args.fields?.length && args.confirm_code_execution !== true) return jsonError("confirm_code_execution=true is required when creating fields");
      if (args.set_default === true && args.confirm_set_default !== true) return jsonError("confirm_set_default=true is required to change the default theme");
      const fieldBytes = args.fields?.reduce((sum, field) => sum + ("value" in field ? field.value.length : 0), 0) ?? 0;
      if (fieldBytes > LIMITS.aggregateFields) return jsonError(`Aggregate theme field content exceeds ${LIMITS.aggregateFields} characters`);

      const theme: Record<string, unknown> = { name: args.name, component: args.component };
      if (args.user_selectable !== undefined) theme.user_selectable = args.user_selectable;
      if (args.color_scheme_id !== undefined) theme.color_scheme_id = args.color_scheme_id;
      if (args.set_default !== undefined) theme.default = args.set_default;
      if (args.fields !== undefined) theme.theme_fields = args.fields.map(fieldPayload);
      const { base, client } = ctx.siteState.ensureSelectedSite();
      const response = await themeMutation(base, () => client.postNoRetry("/admin/themes.json", { theme }));
      const raw = unwrapTheme(response);
      return jsonResponse({ created: true, default_applied: args.set_default === undefined ? null : raw.default === args.set_default, theme: detailedTheme(response, false), code_safety_validated: false });
    } catch (error) {
      if (isZodError(error)) return zodError(error);
      return themeMutationError("Failed to create theme", error);
    }
  },
});
