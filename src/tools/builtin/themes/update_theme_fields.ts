import { defineTool } from "../../definition.js";
import { jsonResponse, jsonError, isZodError, zodError } from "../../../util/json_response.js";
import { updateThemeFieldsSchema, LIMITS } from "./schemas.js";
import { detailedTheme, fieldPayload, unwrapTheme } from "./projections.js";
import { precondition, requireThemeWrite, themeMutation, themeMutationError, writeAnnotations } from "./common.js";

export const updateThemeFieldsTool = defineTool({
  name: "discourse_update_theme_fields",
  title: "Update Theme Fields",
  description: "Replace or explicitly delete selected fields on a local or ZIP-imported theme. Text replacements require value and prohibit upload_id; asset replacements require numeric upload_id with type=upload and prohibit value. This can deploy executable code; Git-backed and system themes are rejected.",
  schema: updateThemeFieldsSchema,
  availability: "writes_enabled",
  toolsets: ["themes"],
  annotations: writeAnnotations(true, true),
  handler: async (input, _extra, ctx, opts) => {
    let attempted = false;
    try {
      const args = updateThemeFieldsSchema.parse(input);
      const accessError = requireThemeWrite(ctx.siteState, opts);
      if (accessError) return accessError;
      const total = args.fields.reduce((sum, field) => sum + ("value" in field ? field.value.length : 0), 0);
      if (total > LIMITS.aggregateFields) return jsonError(`Aggregate theme field content exceeds ${LIMITS.aggregateFields} characters`);
      const { base, client } = ctx.siteState.ensureSelectedSite();
      const beforeResponse = await client.get(`/admin/themes/${args.theme_id}.json`);
      const before = unwrapTheme(beforeResponse);
      if (before.name !== args.expected_theme_name) return precondition("Theme name does not match expected_theme_name", { expected: args.expected_theme_name, actual: before.name ?? null });
      if (before.system === true || args.theme_id < 0) return jsonError("System theme fields cannot be edited");
      const remote = before.remote_theme as Record<string, unknown> | undefined;
      if (remote?.["is_git?"] === true || remote?.is_git === true) return jsonError("Git-backed theme fields cannot be edited directly; use discourse_sync_remote_theme");
      attempted = true;
      const response = await themeMutation(base, () => client.put(`/admin/themes/${args.theme_id}.json`, { theme: { theme_fields: args.fields.map(fieldPayload) } }));
      const projected = detailedTheme(response, false);
      return jsonResponse({
        saved: true,
        healthy: projected.healthy,
        changed_fields: args.fields.map(({ target, name, operation }) => ({ target, name, operation })),
        theme: projected,
        code_safety_validated: false,
      });
    } catch (error) {
      if (isZodError(error)) return zodError(error);
      return themeMutationError("Failed to update theme fields", error, attempted);
    }
  },
});
