import { defineTool } from "../../definition.js";
import { jsonError, jsonResponse } from "../../../util/json_response.js";
import { queryString } from "../common/helpers.js";
import {
  isBlockedSetting, normalizeForComparison, serializeSettingValue, validateSettingValue,
  type SettingValue, type SiteSettingDefinition,
} from "../common/site_setting_values.js";
import { projectSiteSetting, requireAdminWrite, requiresSettingConfirmation, siteSettingMutation, siteSettingMutationError } from "./common.js";
import { updateSiteSettingSchema } from "./schemas.js";

const annotations = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true } as const;
const blockedTypes = new Set(["upload", "uploaded_image_list", "uploaded-image-list", "objects"]);

function exactSetting(data: any, name: string): SiteSettingDefinition | null {
  const rows = Array.isArray(data?.site_settings) ? data.site_settings : [];
  const matches = rows.filter((item: any) => String(item?.setting ?? item?.name ?? "") === name);
  const match = matches.at(-1);
  return match ? { ...match, setting: name } : null;
}
function settingRows(data: any): SiteSettingDefinition[] {
  return Array.isArray(data?.site_settings) ? data.site_settings.map((item: any) => ({ ...item, setting: String(item?.setting ?? item?.name ?? "") })) : [];
}
function truthySetting(value: unknown) { return value === true || value === 1 || ["true", "1", "yes"].includes(String(value).toLowerCase()); }

export const updateSiteSettingTool = defineTool({
  name: "discourse_update_site_setting",
  title: "Update Site Setting",
  description: "Set or reset one ordinary admin-visible Discourse site setting after a fresh optimistic-concurrency check. Secret and structured settings are excluded.",
  schema: updateSiteSettingSchema,
  availability: "writes_enabled",
  toolsets: ["site_settings"],
  annotations,
  handler: async (input, _extra, ctx, opts) => {
    let attempted = false;
    try {
      const accessError = requireAdminWrite(ctx.siteState, opts); if (accessError) return accessError;
      const { setting, operation, expected_current_value, confirm_required_setting } = input;
      if (operation === "set" && input.value === undefined) return jsonError("value is required for set", { code: "invalid_parameters" });
      if (operation === "reset_to_default" && input.value !== undefined) return jsonError("value is forbidden for reset_to_default", { code: "invalid_parameters" });
      const { base, client } = ctx.siteState.ensureSelectedSite();
      const path = `/admin/site_settings.json${queryString({ names: [setting] })}`;
      const beforeData = await client.get(path);
      let definition = exactSetting(beforeData, setting);
      if (!definition) return jsonError("The exact setting is not visible or configurable", { code: "setting_unavailable" });
      const dependencyNames = Array.isArray(definition.depends_on) ? definition.depends_on.filter((name): name is string => typeof name === "string" && /^[a-z0-9_]+$/.test(name)).slice(0, 50) : [];
      if (dependencyNames.length) {
        const dependencyData = await client.get(`/admin/site_settings.json${queryString({ names: [setting, ...dependencyNames] })}`);
        definition = exactSetting(dependencyData, setting);
        if (!definition) return jsonError("The exact setting is no longer visible or configurable", { code: "setting_unavailable" });
        const definitions = new Map(settingRows(dependencyData).map((item) => [item.setting, item]));
        const allowedByName = definition.depends_on_values && typeof definition.depends_on_values === "object" && !Array.isArray(definition.depends_on_values) ? definition.depends_on_values as Record<string, unknown> : {};
        const unsatisfied = dependencyNames.filter((name) => {
          const parent = definitions.get(name); if (!parent || isBlockedSetting(parent)) return false;
          const allowed = Array.isArray(allowedByName[name]) ? allowedByName[name] as unknown[] : null;
          return allowed ? !allowed.map(String).includes(String(parent.value)) : !truthySetting(parent.value);
        });
        if (unsatisfied.length) {
          const safeAllowed = Object.fromEntries(Object.entries(allowedByName).slice(0, 50).map(([name, values]) => [name.slice(0, 200), Array.isArray(values) ? values.slice(0, 50).map((value) => String(value).slice(0, 1_000)) : []]));
          return jsonError("The site setting's declared dependency is not satisfied", { code: "precondition_failed", setting, depends_on: dependencyNames, depends_behavior: String(definition.depends_behavior ?? "").slice(0, 100) || null, depends_on_values: safeAllowed, unsatisfied_dependencies: unsatisfied });
        }
      }
      if (isBlockedSetting(definition)) return jsonError("Sensitive settings are outside this tool's scope", { code: "sensitive_setting_out_of_scope" });
      if (blockedTypes.has(String(definition.type ?? "").toLowerCase())) return jsonError("This setting type is outside this tool's scope", { code: "unsupported_setting_type" });
      if (normalizeForComparison(expected_current_value) !== normalizeForComparison(definition.value)) return jsonError("The site setting changed since it was read", { code: "precondition_failed", setting });
      if (requiresSettingConfirmation(definition.requires_confirmation) && confirm_required_setting !== true) return jsonError("This setting requires confirm_required_setting=true", { code: "confirmation_required", setting });
      const desired = (operation === "reset_to_default" ? definition.default : input.value) as SettingValue;
      if (desired === undefined) return jsonError("The setting has no visible default to reset to", { code: "setting_unavailable" });
      const validation = validateSettingValue(definition, desired);
      if (validation) return jsonError(validation, { code: "invalid_parameters", setting });
      if (normalizeForComparison(desired) === normalizeForComparison(definition.value)) return jsonError("The requested mutation is a no-op", { code: "no_change", setting });
      await siteSettingMutation(base, async () => {
        attempted = true;
        await client.putNoRetry(`/admin/site_settings/${encodeURIComponent(setting)}.json`, { [setting]: serializeSettingValue(desired) });
      });
      let afterData: unknown;
      try { afterData = await client.get(path); }
      catch { return jsonError("The update outcome could not be verified because the exact re-read failed", { code: "outcome_unknown", outcome_unknown: true, setting, guidance: "Re-read the affected site setting before retrying." }); }
      const after = exactSetting(afterData, setting);
      if (!after || normalizeForComparison(after.value) !== normalizeForComparison(desired)) {
        return jsonError("The update response could not be verified by an exact re-read", { code: "verification_failed", updated: false, verified: false, setting });
      }
      return jsonResponse({ updated: true, setting, operation, before: projectSiteSetting(definition, ctx.maxReadLength), after: projectSiteSetting(after, ctx.maxReadLength), verified: true });
    } catch (error) {
      return siteSettingMutationError("Failed to update site setting", error, attempted);
    }
  },
});
