import { z } from "zod";

export const settingValueSchema = z.union([
  z.string().max(20_000),
  z.number().finite(),
  z.boolean(),
  z.array(z.union([z.string().max(2_000), z.number().finite()])).max(200),
]);
export type SettingValue = z.infer<typeof settingValueSchema>;

export interface SiteSettingDefinition {
  setting: string;
  value?: unknown;
  default?: unknown;
  type?: string;
  secret?: boolean;
  valid_values?: Array<unknown>;
  min?: number;
  max?: number;
  [key: string]: unknown;
}

const CREDENTIAL_NAME = /(?:^|_)(?:secret|token|password|passphrase|private_key|access_keys?|api_keys?|credentials?)(?:$|_)/i;

export function isBlockedSetting(setting: SiteSettingDefinition) {
  return setting.secret === true || CREDENTIAL_NAME.test(setting.setting);
}

export function normalizeForComparison(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).join("|");
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value ?? "");
}

export function serializeSettingValue(value: SettingValue): string | number | boolean {
  return Array.isArray(value) ? value.map(String).join("|") : value;
}

export function validateSettingValue(definition: SiteSettingDefinition, value: SettingValue): string | null {
  const type = String(definition.type ?? "string").toLowerCase();
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
    for (const item of submitted) if (!allowed.has(String(item))) return `${definition.setting} contains unsupported value '${String(item).slice(0, 100)}'`;
  }
  return null;
}
