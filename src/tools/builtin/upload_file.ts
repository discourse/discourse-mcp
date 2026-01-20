import { z } from "zod";
import { readFile, realpath } from "node:fs/promises";
import { basename, isAbsolute, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import type { RegisterFn } from "../types.js";
import { jsonResponse, jsonError, rateLimit, isZodError, zodError } from "../../util/json_response.js";

// Upload types that require user_id
const USER_REQUIRED_TYPES = ["avatar", "profile_background", "card_background"];

// Common MIME types for image uploads
const MIME_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
};

/**
 * Infer MIME type from filename extension or data URI.
 * @param filename - The filename to extract extension from
 * @param dataUriMime - Optional MIME type from a data URI (takes precedence)
 * @returns The inferred MIME type or "application/octet-stream" as fallback
 */
function inferMimeType(filename: string, dataUriMime?: string): string {
  if (dataUriMime) return dataUriMime;
  const ext = filename.split(".").pop()?.toLowerCase();
  return (ext && MIME_TYPES[ext]) || "application/octet-stream";
}

export const registerUploadFile: RegisterFn = (server, ctx, opts) => {
  if (!opts?.allowWrites) return;

  const schema = z.object({
    upload_type: z.enum(["avatar", "profile_background", "card_background", "composer"])
      .describe("Type of upload"),
    image_data: z.string().optional().describe("Base64 image data (with or without data URI prefix)"),
    url: z.string().optional().describe("Remote HTTP(S) URL for Discourse to fetch, or file:// URL / absolute local path"),
    filename: z.string().optional().describe("Filename (required with image_data, optional for file paths)"),
    user_id: z.number().int().positive().optional().describe("User ID (required for avatar/profile_background/card_background uploads)"),
  });

  server.registerTool(
    "discourse_upload_file",
    {
      title: "Upload File",
      description: "Upload an image or file to Discourse. Provide either: image_data (base64 with filename), a remote HTTP(S) URL, or an absolute local file path. user_id is required for avatar/background uploads. Returns upload_id for use in avatar/profile updates. Use short_url to embed images in posts.",
      inputSchema: schema.shape,
    },
    async (input, _extra) => {
      try {
        const args = schema.parse(input);
        // Validate: must provide either image_data OR url, not both or neither
        const hasImageData = !!args.image_data;
        const hasUrl = !!args.url;
        if (hasImageData === hasUrl) {
          return jsonError("Must provide either image_data OR url, not both or neither");
        }
        if (hasImageData && !args.filename) {
          return jsonError("filename is required when using image_data");
        }

        // Validate: user_id required for avatar/background uploads
        if (USER_REQUIRED_TYPES.includes(args.upload_type) && args.user_id === undefined) {
          return jsonError(`user_id is required for ${args.upload_type} uploads`);
        }

        // Validate URL scheme if provided and extract local file path if applicable
        let localFilePath: string | null = null;

        if (args.url) {
          // Try parsing as URL first
          let parsedUrl: URL | null = null;
          try {
            parsedUrl = new URL(args.url);
          } catch {
            // Not a valid URL - might be a plain file path
          }

          if (parsedUrl) {
            const scheme = parsedUrl.protocol.replace(":", "").toLowerCase();
            if (scheme === "http" || scheme === "https") {
              // Remote URL - will be handled by Discourse
            } else if (scheme === "file") {
              // File URL - convert to path using proper decoder
              try {
                localFilePath = fileURLToPath(parsedUrl);
              } catch (e: any) {
                return jsonError(`Invalid file URL: ${e?.message || String(e)}`);
              }
            } else {
              return jsonError(`Unsupported URL scheme: ${scheme}. Use http(s) or file://`);
            }
          } else {
            // Plain path (not a URL) - must be absolute
            if (!isAbsolute(args.url)) {
              return jsonError("Local file path must be absolute");
            }
            localFilePath = args.url;
          }

          // Validate local file paths against allowlist
          if (localFilePath) {
            if (!isAbsolute(localFilePath)) {
              return jsonError("Local file path must be absolute");
            }

            // Check against allowlist
            const allowedPaths = ctx.allowedUploadPaths || [];
            if (allowedPaths.length === 0) {
              return jsonError("Local file uploads are disabled. Configure --allowed_upload_paths to enable.");
            }

            // Resolve symlinks to get the real path (prevents symlink escapes)
            let resolvedPath: string;
            try {
              resolvedPath = await realpath(localFilePath);
            } catch (e: any) {
              return jsonError(`Cannot access file: ${e?.message || String(e)}`);
            }

            // Resolve allowed directories too (they might contain symlinks)
            const resolvedAllowedPaths: string[] = [];
            for (const allowedDir of allowedPaths) {
              try {
                resolvedAllowedPaths.push(await realpath(allowedDir));
              } catch {
                // Skip non-existent allowed paths
                resolvedAllowedPaths.push(normalize(allowedDir));
              }
            }

            const isAllowed = resolvedAllowedPaths.some(allowedDir => {
              return resolvedPath === allowedDir || resolvedPath.startsWith(allowedDir + "/");
            });

            if (!isAllowed) {
              return jsonError(`File path not in allowed directories. Allowed: ${allowedPaths.join(", ")}`);
            }
          }
        }

        await rateLimit("upload");
        const { client } = ctx.siteState.ensureSelectedSite();

        const formData = new FormData();
        formData.set("type", args.upload_type);

        if (args.user_id !== undefined) {
          formData.set("user_id", String(args.user_id));
        }

        if (args.url && !localFilePath) {
          // Remote URL upload - Discourse will fetch it
          formData.set("url", args.url);
        } else if (localFilePath) {
          // Local file - read and upload
          const fileData = await readFile(localFilePath);
          const filename = args.filename || basename(localFilePath);
          const mimeType = inferMimeType(filename);

          const blob = new Blob([new Uint8Array(fileData)], { type: mimeType });
          formData.set("file", blob, filename);
        } else if (args.image_data && args.filename) {
          // Base64 upload - convert to Blob
          let base64Data = args.image_data;
          let dataUriMime: string | undefined;

          // Handle data URI prefix if present
          const dataUriMatch = base64Data.match(/^data:([^;]+);base64,(.+)$/);
          if (dataUriMatch) {
            dataUriMime = dataUriMatch[1];
            base64Data = dataUriMatch[2];
          }

          const mimeType = inferMimeType(args.filename, dataUriMime);
          const binaryData = Buffer.from(base64Data, "base64");
          const blob = new Blob([binaryData], { type: mimeType });
          formData.set("file", blob, args.filename);
        }

        const response = await client.postMultipart("/uploads.json", formData) as any;

        return jsonResponse({
          id: response.id,
          url: response.url,
          short_url: response.short_url,
          short_path: response.short_path,
          original_filename: response.original_filename,
          extension: response.extension,
          width: response.width,
          height: response.height,
          filesize: response.filesize,
          human_filesize: response.human_filesize,
        });
      } catch (e: unknown) {
        if (isZodError(e)) return zodError(e);
        const err = e as any;
        return jsonError(`Failed to upload file: ${err?.message || String(e)}`);
      }
    }
  );
};
