import { z } from "zod";

export const LIMITS = {
  name: 200,
  query: 200,
  url: 10_000,
  branch: 500,
  fieldValue: 1024 * 1024,
  aggregateFields: 4 * 1024 * 1024,
  archive: 25 * 1024 * 1024,
  asset: 25 * 1024 * 1024,
  translationValue: 100_000,
  outputText: 20_000,
  outputAggregate: 100_000,
} as const;

export const nonzeroId = z.number().int().refine((id) => id !== 0, "ID must be nonzero");
export const positiveId = z.number().int().positive();
const fieldTarget = z.enum(["common", "desktop", "mobile", "settings", "translations", "extra_scss", "extra_js", "tests_js", "migrations", "about"])
  .describe("Discourse theme-field target");
const textFieldType = z.enum(["html", "scss", "yaml", "javascript", "json"]);
const fieldIdentity = {
  name: z.string().min(1).max(200).describe("Theme field name"),
  target: fieldTarget,
};

const textThemeFieldSchema = z.object({
  ...fieldIdentity,
  operation: z.literal("replace").default("replace"),
  value: z.string().min(1, "Text replacement value cannot be empty; use operation=delete").max(LIMITS.fieldValue)
    .describe("Complete textual field content. Do not provide upload_id."),
  type: textFieldType.optional().describe("Friendly textual field type; omit when Discourse can infer it"),
}).strict().describe("Text field replacement: value is required and upload_id is not accepted");

const uploadThemeFieldSchema = z.object({
  ...fieldIdentity,
  operation: z.literal("replace").default("replace"),
  upload_id: positiveId.describe("Numeric upload ID returned by discourse_upload_theme_asset"),
  type: z.literal("upload").describe("Required for an upload-backed field"),
}).strict().describe("Upload field replacement: numeric upload_id and type=upload are required; value is not accepted");

const deleteThemeFieldSchema = z.object({
  ...fieldIdentity,
  operation: z.literal("delete"),
}).strict().describe("Explicit field deletion: value, upload_id, and type are not accepted");

/** Create accepts only populated text/upload fields; deletion is update-only. */
export const newThemeFieldSchema = z.union([textThemeFieldSchema, uploadThemeFieldSchema]);
/** Update additionally accepts an explicit deletion variant. */
export const themeFieldSchema = z.union([textThemeFieldSchema, uploadThemeFieldSchema, deleteThemeFieldSchema]);

export type ThemeFieldInput = z.output<typeof themeFieldSchema>;

export const listThemesSchema = z.object({
  kind: z.enum(["theme", "component", "all"]).default("all"),
  query: z.string().max(LIMITS.query).optional(),
  include_system: z.boolean().default(true),
  limit: z.number().int().min(1).max(500).default(100),
  offset: z.number().int().min(0).default(0),
}).strict();

export const getThemeSchema = z.object({ theme_id: nonzeroId, include_field_values: z.boolean().default(false) }).strict();

export const createThemeSchema = z.object({
  name: z.string().trim().min(1).max(LIMITS.name),
  component: z.boolean().default(false),
  user_selectable: z.boolean().optional(),
  color_scheme_id: positiveId.optional(),
  fields: z.array(newThemeFieldSchema).max(100).optional()
    .describe("Optional populated fields. Each item is either a text replacement with value, or an upload replacement with numeric upload_id and type=upload."),
  set_default: z.boolean().optional(),
  confirm_code_execution: z.boolean().optional(),
  confirm_set_default: z.boolean().optional(),
}).strict();

const archiveDataSchema = z.object({
  base64: z.string().min(1).max(Math.ceil(LIMITS.archive * 4 / 3) + 4),
  filename: z.string().min(1).max(255),
}).strict();
const repositoryInstallSourceSchema = z.object({
  kind: z.literal("repository"),
  remote_url: z.string().min(1).max(LIMITS.url).describe("Git repository URL; archive inputs are not part of this variant"),
  branch: z.string().max(LIMITS.branch).optional(),
  force_placeholder: z.boolean().default(false),
}).strict().describe("Repository installation source");
const archiveDataInstallSourceSchema = z.object({
  kind: z.literal("archive"),
  archive_data: archiveDataSchema.describe("Bounded base64 archive and filename"),
  replace_theme_id: positiveId.optional(),
  component_update_mode: z.enum(["none", "add_missing", "sync"]).default("add_missing"),
  run_migrations: z.boolean().default(true),
}).strict().describe("Base64 archive installation source");
const archivePathInstallSourceSchema = z.object({
  kind: z.literal("archive"),
  archive_path: z.string().min(1).max(4096).describe("Absolute local path or file:// URL beneath allowed_upload_paths"),
  replace_theme_id: positiveId.optional(),
  component_update_mode: z.enum(["none", "add_missing", "sync"]).default("add_missing"),
  run_migrations: z.boolean().default(true),
}).strict().describe("Allowlisted local archive installation source");

export const installThemeSchema = z.object({
  source: z.union([
    repositoryInstallSourceSchema,
    archiveDataInstallSourceSchema,
    archivePathInstallSourceSchema,
  ]).describe("Choose exactly one repository, base64 archive, or local archive source variant. Never add placeholder fields from another variant."),
  confirm_external_code: z.literal(true),
  confirm_force_placeholder: z.boolean().optional(),
  confirm_replace: z.boolean().optional(),
  confirm_run_migrations: z.boolean().optional(),
}).strict();

export const updateThemeSchema = z.object({
  theme_id: nonzeroId,
  name: z.string().trim().min(1).max(LIMITS.name).optional(),
  color_scheme_id: positiveId.nullable().optional(),
  dark_color_scheme_id: positiveId.nullable().optional(),
  user_selectable: z.boolean().optional(),
  auto_update: z.boolean().optional(),
  enabled: z.boolean().optional(),
  parent_theme_ids: z.array(positiveId).max(100).optional(),
  child_theme_ids: z.array(positiveId).max(100).optional(),
  set_default: z.boolean().optional(),
  expected_name: z.string().max(LIMITS.name).optional(),
  confirm_default_change: z.boolean().optional(),
  confirm_component_graph_replace: z.boolean().optional(),
}).strict();

export const updateThemeFieldsSchema = z.object({
  theme_id: nonzeroId,
  fields: z.array(themeFieldSchema).min(1).max(100),
  expected_theme_name: z.string().min(1).max(LIMITS.name),
  confirm_code_execution: z.literal(true),
  confirm_field_replacement: z.literal(true),
}).strict();

export const updateThemeSettingSchema = z.object({
  theme_id: nonzeroId,
  name: z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/),
  value: z.unknown().optional(),
  operation: z.enum(["set", "revert"]).default("set"),
  expected_current_value: z.unknown().optional(),
  confirm_revert: z.boolean().optional(),
}).strict();

export const updateThemeTranslationsSchema = z.object({
  theme_id: nonzeroId,
  locale: z.string().min(2).max(35).regex(/^[A-Za-z0-9_-]+$/),
  translations: z.record(z.string().min(1).max(300), z.string().max(LIMITS.translationValue)).refine((v) => Object.keys(v).length > 0 && Object.keys(v).length <= 200, "translations must contain 1-200 entries"),
  expected_theme_name: z.string().min(1).max(LIMITS.name),
  confirm_translation_replacement: z.literal(true),
}).strict();

export const syncRemoteThemeSchema = z.object({
  theme_id: positiveId,
  action: z.enum(["check", "update"]),
  expected_remote_url: z.string().max(LIMITS.url).optional(),
  confirm_external_code: z.boolean().optional(),
  confirm_run_migrations: z.boolean().optional(),
}).strict();

export const uploadThemeAssetSchema = z.object({
  file_data: z.string().max(Math.ceil(LIMITS.asset * 4 / 3) + 4).optional(),
  file_path: z.string().max(4096).optional(),
  filename: z.string().min(1).max(255).optional(),
  confirm_asset_upload: z.literal(true),
}).strict();

export const deleteThemeSchema = z.object({
  theme_id: positiveId,
  expected_theme_name: z.string().min(1).max(LIMITS.name),
  confirm_delete: z.literal(true),
}).strict();
