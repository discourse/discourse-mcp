import { z } from "zod";
import type { HttpClient } from "../../../http/client.js";
import { AI_FEATURES_BASE } from "../discourse_ai/common.js";

export const settingValueSchema = z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()]))]);
export type SettingValue = z.infer<typeof settingValueSchema>;
export interface SiteSettingDefinition { setting: string; value?: unknown; default?: unknown; type?: string; secret?: boolean; valid_values?: Array<unknown>; min?: number; max?: number; [key: string]: unknown }

const CREDENTIAL_NAME = /(?:^|_)(?:secret|token|password|passphrase|private_key|access_keys?|api_keys?|credentials?)(?:$|_)/i;
export function isBlockedSetting(setting: SiteSettingDefinition) {
  return setting.secret === true || CREDENTIAL_NAME.test(setting.setting);
}

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

export function normalizeForComparison(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).join("|");
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value ?? "");
}

export function validateSettingValue(definition: SiteSettingDefinition, value: SettingValue): string | null {
  const type = String(definition.type ?? "string");
  const scalar = Array.isArray(value) ? undefined : String(value).trim();
  let numericValue: number | undefined;
  if (type === "bool" || type === "boolean") {
    if (typeof value !== "boolean" && scalar !== "true" && scalar !== "false") return `${definition.setting} must be a boolean`;
  }
  if (type === "int" || type === "integer") {
    if (typeof value === "number" && Number.isInteger(value)) numericValue = value;
    else if (typeof value === "string" && /^-?\d+$/.test(value.trim())) numericValue = Number(value);
    else return `${definition.setting} must be an integer`;
  }
  if (type === "float") {
    numericValue = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
    if (!Number.isFinite(numericValue)) return `${definition.setting} must be a number`;
  }
  if (numericValue !== undefined) {
    if (typeof definition.min === "number" && numericValue < definition.min) return `${definition.setting} must be at least ${definition.min}`;
    if (typeof definition.max === "number" && numericValue > definition.max) return `${definition.setting} must be at most ${definition.max}`;
  }
  if (type.includes("list") && !Array.isArray(value) && typeof value !== "string") return `${definition.setting} must be an array or pipe-delimited string`;
  if (Array.isArray(definition.valid_values) && definition.valid_values.length) {
    const allowed = new Set(definition.valid_values.map((item: any) => String(item?.value ?? item?.id ?? item)));
    const submitted = Array.isArray(value) ? value : [value];
    for (const item of submitted) if (!allowed.has(String(item))) return `${definition.setting} contains unsupported value '${item}'`;
  }
  return null;
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
