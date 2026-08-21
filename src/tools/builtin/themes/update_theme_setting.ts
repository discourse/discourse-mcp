import { defineTool } from "../../definition.js";
import { jsonResponse, jsonError, isZodError, zodError } from "../../../util/json_response.js";
import { updateThemeSettingSchema } from "./schemas.js";
import { summariesEqual, unwrapTheme } from "./projections.js";
import { precondition, requireThemeWrite, themeMutation, themeMutationError, writeAnnotations } from "./common.js";

function settingName(row: any): unknown { return row?.setting ?? row?.name; }
function encodeValue(type: unknown, value: unknown): unknown {
  if (value === null) throw new Error("JSON null is not a valid setting value; use operation=revert");
  if (type === "bool" || type === "boolean") {
    if (typeof value !== "boolean") throw new Error("This setting requires a boolean value");
    return value ? "true" : "false";
  }
  if (type === "objects") {
    if (typeof value !== "object") throw new Error("This objects setting requires an object or array value");
    return JSON.stringify(value);
  }
  return value;
}

export const updateThemeSettingTool = defineTool({
  name: "discourse_update_theme_setting",
  title: "Update Theme Setting",
  description: "Set or explicitly revert one declared setting owned by a theme/component. This does not mutate themeable global site settings; object values are validated upstream against the declared schema.",
  schema: updateThemeSettingSchema,
  availability: "writes_enabled",
  toolsets: ["themes"],
  annotations: writeAnnotations(true, true),
  handler: async (input, _extra, ctx, opts) => {
    let attempted = false;
    try {
      const args = updateThemeSettingSchema.parse(input);
      const accessError = requireThemeWrite(ctx.siteState, opts);
      if (accessError) return accessError;
      if (args.operation === "set" && args.value === undefined) return jsonError("value is required for set");
      if (args.operation === "revert" && args.value !== undefined) return jsonError("value is forbidden for revert");
      if (args.operation === "revert" && args.confirm_revert !== true) return jsonError("confirm_revert=true is required to revert a theme setting");
      const { base, client } = ctx.siteState.ensureSelectedSite();
      const detail = unwrapTheme(await client.get(`/admin/themes/${args.theme_id}.json`));
      if (detail.system === true || args.theme_id < 0) return jsonError("System theme settings cannot be changed");
      const settings = Array.isArray(detail.settings) ? detail.settings as any[] : [];
      const definition = settings.find((row) => settingName(row) === args.name);
      if (!definition) return jsonError(`Theme does not declare setting '${args.name}'`, { code: "invalid_parameters", available_settings: settings.map(settingName).filter(Boolean).slice(0, 100) });
      const previous = definition.value;
      if (args.expected_current_value !== undefined && !summariesEqual(previous, args.expected_current_value)) {
        return precondition("Theme setting value does not match expected_current_value", { setting: args.name, expected: args.expected_current_value, actual: previous });
      }
      const payload: Record<string, unknown> = { name: args.name };
      if (args.operation === "set") payload.value = encodeValue(definition.type, args.value);
      attempted = true;
      const response = await themeMutation(base, () => client.put(`/admin/themes/${args.theme_id}/setting.json`, payload));
      const returned = response !== null && typeof response === "object" ? (response as any)[args.name] : undefined;
      const expected = args.operation === "set" ? args.value : undefined;
      return jsonResponse({ setting: args.name, operation: args.operation, previous_value: previous ?? null, value: returned ?? null, applied: summariesEqual(returned, expected), setting_type: definition.type ?? null });
    } catch (error) {
      if (isZodError(error)) return zodError(error);
      if (!attempted && error instanceof Error) return jsonError(error.message, { code: "invalid_parameters" });
      return themeMutationError("Failed to update theme setting", error, attempted);
    }
  },
});
