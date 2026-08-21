import { basename } from "node:path";
import { defineTool } from "../../definition.js";
import { jsonResponse, jsonError, isZodError, zodError } from "../../../util/json_response.js";
import { decodeBase64, readAllowedLocalFile } from "../../../util/safe_local_file.js";
import { uploadThemeAssetSchema, LIMITS } from "./schemas.js";
import { requireThemeWrite, themeMutation, themeMutationError, writeAnnotations } from "./common.js";

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", css: "text/css", js: "text/javascript", json: "application/json" };
function mime(filename: string) { return MIME[filename.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream"; }

export const uploadThemeAssetTool = defineTool({
  name: "discourse_upload_theme_asset",
  title: "Upload Theme Asset",
  description: "Upload a bounded local/base64 asset for later attachment to a theme field. No remote URL fetch is supported; upload alone does not attach or deploy the asset.",
  schema: uploadThemeAssetSchema,
  availability: "writes_enabled",
  toolsets: ["themes"],
  annotations: writeAnnotations(false, false),
  handler: async (input, _extra, ctx, opts) => {
    let attempted = false;
    try {
      const args = uploadThemeAssetSchema.parse(input);
      const accessError = requireThemeWrite(ctx.siteState, opts);
      if (accessError) return accessError;
      if ((args.file_data === undefined) === (args.file_path === undefined)) return jsonError("Provide exactly one of file_data or file_path");
      if (args.file_data !== undefined && !args.filename) return jsonError("filename is required with file_data");
      let data: Buffer;
      let filename: string;
      if (args.file_data !== undefined) {
        filename = basename(args.filename!);
        data = decodeBase64(args.file_data, LIMITS.asset);
      } else {
        const file = await readAllowedLocalFile(args.file_path!, ctx.allowedUploadPaths, LIMITS.asset);
        filename = basename(file.path);
        data = file.data;
      }
      const form = new FormData();
      form.set("file", new Blob([new Uint8Array(data)], { type: mime(filename) }), filename);
      const { base, client } = ctx.siteState.ensureSelectedSite();
      attempted = true;
      const response = await themeMutation(base, () => client.postMultipart("/admin/themes/upload_asset.json", form, { expectedStatus: 201 })) as any;
      if (!Number.isInteger(response?.upload_id) || response.upload_id <= 0) return jsonError("Theme asset upload returned no valid upload_id", { code: "invalid_upstream_response" });
      return jsonResponse({ upload_id: response.upload_id, filename, size: data.byteLength, attached: false, warning: "The asset is not attached to a theme until a later theme field update succeeds." });
    } catch (error) {
      if (isZodError(error)) return zodError(error);
      return themeMutationError("Failed to upload theme asset", error, attempted);
    }
  },
});
