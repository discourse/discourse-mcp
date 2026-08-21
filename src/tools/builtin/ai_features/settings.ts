import type { HttpClient } from "../../../http/client.js";
import { AI_FEATURES_BASE } from "../discourse_ai/common.js";
import {
  isBlockedSetting,
  normalizeForComparison,
  settingValueSchema,
  validateSettingValue,
  type SettingValue,
  type SiteSettingDefinition,
} from "../common/site_setting_values.js";

export { isBlockedSetting, normalizeForComparison, settingValueSchema, validateSettingValue };
export type { SettingValue, SiteSettingDefinition };

export function featureModules(index: unknown): any[] {
  if (Array.isArray(index)) return index;
  if (index && typeof index === "object" && Array.isArray((index as any).ai_features)) return (index as any).ai_features;
  return [];
}

export async function resolveFeatureModule(client: HttpClient, moduleId: string | number) {
  const index = await client.get(`${AI_FEATURES_BASE}.json`);
  const modules = featureModules(index);
  const module = modules.find((item: any) => String(item?.id) === String(moduleId));
  if (!module) throw new Error(`AI feature module '${moduleId}' was not found or is not visible`);
  if (typeof module.module_name !== "string" || !/^[a-zA-Z0-9_-]+$/.test(module.module_name)) throw new Error("Feature module returned an unsafe module_name");
  return module;
}

export async function fetchFeatureConfig(client: HttpClient, moduleId: string | number) {
  const module = await resolveFeatureModule(client, moduleId);
  const area = `ai-features/${module.module_name}`;
  const query = new URLSearchParams({ filter_area: area });
  const [detail, settingsRaw] = await Promise.all([
    client.get(`${AI_FEATURES_BASE}/${module.id}/edit.json`),
    client.get(`/admin/config/site_settings.json?${query.toString()}`),
  ]);
  const allSettings: SiteSettingDefinition[] = Array.isArray((settingsRaw as any)?.site_settings) ? (settingsRaw as any).site_settings : [];
  const blocked = allSettings.filter(isBlockedSetting);
  const settings = allSettings.filter((item) => !isBlockedSetting(item));
  return { module: detail ?? module, area, settings, blocked_settings: blocked.map((item) => ({ setting: item.setting, reason: "Credential/secret settings are outside this tool's scope" })) };
}

function scalarString(value: SettingValue): string {
  return Array.isArray(value) ? value.map(String).join("|") : String(value);
}

export function buildBulkUpdate(config: Awaited<ReturnType<typeof fetchFeatureConfig>>, changes: Record<string, SettingValue>, originalValues?: Record<string, SettingValue>) {
  const definitions = new Map(config.settings.map((item) => [item.setting, item]));
  const settings: Record<string, { value: string | number | boolean }> = {};
  for (const [name, value] of Object.entries(changes)) {
    const definition = definitions.get(name);
    if (!definition) throw new Error(`Setting '${name}' is not editable in exact area '${config.area}'`);
    const validation = validateSettingValue(definition, value); if (validation) throw new Error(validation);
    if (originalValues && Object.prototype.hasOwnProperty.call(originalValues, name) && normalizeForComparison(originalValues[name]) !== normalizeForComparison(definition.value)) throw new Error(`Setting '${name}' changed since it was read; refresh the feature config before updating`);
    settings[name] = { value: scalarString(value) };
  }
  if (originalValues) for (const name of Object.keys(originalValues)) if (!Object.prototype.hasOwnProperty.call(changes, name)) throw new Error(`original_values contains '${name}', which is not being updated`);
  return { settings };
}
