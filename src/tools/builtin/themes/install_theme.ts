import { basename } from "node:path";
import { defineTool } from "../../definition.js";
import { jsonResponse, jsonError, isZodError, zodError } from "../../../util/json_response.js";
import { decodeBase64, readAllowedLocalFile } from "../../../util/safe_local_file.js";
import { installThemeSchema, LIMITS } from "./schemas.js";
import { detailedTheme, unwrapTheme } from "./projections.js";
import { requireThemeWrite, themeMutation, themeMutationError, validateRepositoryUrl, writeAnnotations } from "./common.js";

function archiveMime(filename: string): string | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".zip")) return "application/zip";
  if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz") || lower.endsWith(".gz")) return "application/gzip";
  return null;
}

export const installThemeTool = defineTool({
  name: "discourse_install_theme",
  title: "Install Theme",
  description: "Install a Git repository or ZIP/gzip archive. Set source to exactly one nested variant: {kind:repository, remote_url...}, {kind:archive, archive_data...}, or {kind:archive, archive_path...}; never add placeholder fields from another variant. External code and migrations can have site-wide impact and are not sandboxed.",
  schema: installThemeSchema,
  availability: "writes_enabled",
  toolsets: ["themes"],
  annotations: writeAnnotations(true, false),
  handler: async (input, _extra, ctx, opts) => {
    let attempted = false;
    try {
      const args = installThemeSchema.parse(input);
      const accessError = requireThemeWrite(ctx.siteState, opts);
      if (accessError) return accessError;
      const source = args.source;
      if (source.kind === "repository" && source.force_placeholder && args.confirm_force_placeholder !== true) return jsonError("confirm_force_placeholder=true is required when force_placeholder is requested");
      if (source.kind === "archive" && source.replace_theme_id && args.confirm_replace !== true) return jsonError("confirm_replace=true is required when replacing a theme");
      if (source.kind === "archive" && source.run_migrations && args.confirm_run_migrations !== true) return jsonError("confirm_run_migrations=true is required when archive migrations will run");
      const { base, client } = ctx.siteState.ensureSelectedSite();
      let response: unknown;
      if (source.kind === "repository") {
        const remote = source.remote_url;
        const urlError = validateRepositoryUrl(remote);
        if (urlError) return jsonError(urlError, { code: "invalid_parameters" });
        const payload: Record<string, unknown> = { remote: remote.trim() };
        if (source.branch !== undefined) payload.branch = source.branch;
        if (source.force_placeholder) payload.force = true;
        attempted = true;
        response = await themeMutation(base, () => client.postNoRetry("/admin/themes/import.json", payload));
      } else {
        let data: Buffer;
        let filename: string;
        if ("archive_data" in source) {
          filename = basename(source.archive_data.filename);
          data = decodeBase64(source.archive_data.base64, LIMITS.archive);
        } else {
          const file = await readAllowedLocalFile(source.archive_path, ctx.allowedUploadPaths, LIMITS.archive);
          filename = basename(file.path);
          data = file.data;
        }
        const mime = archiveMime(filename);
        if (!mime) return jsonError("Theme archives must use a supported .zip, .gz, .tgz, or .tar.gz filename");
        const form = new FormData();
        form.set("theme", new Blob([new Uint8Array(data)], { type: mime }), filename);
        if (source.replace_theme_id !== undefined) form.set("theme_id", String(source.replace_theme_id));
        form.set("components", source.component_update_mode === "add_missing" ? "add" : source.component_update_mode);
        if (!source.run_migrations) form.set("skip_migrations", "true");
        attempted = true;
        response = await themeMutation(base, () => client.postMultipart("/admin/themes/import.json", form, { expectedStatus: 201 }));
      }
      const raw = unwrapTheme(response);
      const remote = raw.remote_theme as Record<string, unknown> | undefined;
      const placeholderEvidence = source.kind === "repository" && source.force_placeholder
        ? (remote?.last_error_text ? true : null)
        : false;
      return jsonResponse({
        source: source.kind,
        created_or_replaced: true,
        force_fallback_requested: source.kind === "repository" && source.force_placeholder,
        placeholder_created: placeholderEvidence,
        remote_attached: raw.remote_theme_id !== undefined ? raw.remote_theme_id !== null : null,
        theme: detailedTheme(response, false),
        code_safety_validated: false,
      });
    } catch (error) {
      if (isZodError(error)) return zodError(error);
      return themeMutationError("Failed to install theme", error, attempted);
    }
  },
});
