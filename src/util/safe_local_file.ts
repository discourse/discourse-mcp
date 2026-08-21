import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

export interface SafeLocalFile {
  path: string;
  data: Buffer;
  size: number;
}

/** Convert an absolute path or file:// URL to a local path. */
export function localPathFromInput(input: string): string {
  let path = input;
  try {
    const parsed = new URL(input);
    if (parsed.protocol !== "file:") {
      throw new Error("Only file:// URLs are accepted for local files");
    }
    path = fileURLToPath(parsed);
  } catch (error) {
    if (input.toLowerCase().startsWith("file:")) throw error;
  }
  if (!isAbsolute(path)) throw new Error("Local file path must be absolute");
  return path;
}

function isWithin(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/**
 * Resolve and read a regular file beneath one of the configured roots.
 * The target and roots are resolved through realpath and the target is checked
 * again immediately before reading to narrow symlink/TOCTOU exposure.
 */
export async function readAllowedLocalFile(
  input: string,
  allowedRoots: readonly string[] | undefined,
  maxBytes: number,
): Promise<SafeLocalFile> {
  const requested = localPathFromInput(input);
  if (!allowedRoots?.length) {
    throw new Error("Local file uploads are disabled. Configure --allowed_upload_paths to enable.");
  }

  const roots: string[] = [];
  for (const root of allowedRoots) {
    if (!isAbsolute(root)) throw new Error(`Allowed upload path must be absolute: ${root}`);
    try {
      const resolvedRoot = await realpath(root);
      const rootInfo = await stat(resolvedRoot);
      if (!rootInfo.isDirectory()) throw new Error("not a directory");
      roots.push(resolvedRoot);
    } catch {
      throw new Error(`Cannot access allowed upload directory: ${root}`);
    }
  }

  let resolved = await realpath(requested);
  if (!roots.some((root) => isWithin(root, resolved))) {
    throw new Error(`File path is outside allowed upload directories: ${allowedRoots.join(", ")}`);
  }
  let info = await stat(resolved);
  if (!info.isFile()) throw new Error("Local upload input must be a regular file");
  if (info.size > maxBytes) throw new Error(`File exceeds maximum size of ${maxBytes} bytes`);

  // Re-resolve and re-check immediately before the read.
  resolved = await realpath(requested);
  if (!roots.some((root) => isWithin(root, resolved))) {
    throw new Error("File path changed and is no longer within an allowed upload directory");
  }
  info = await stat(resolved);
  if (!info.isFile()) throw new Error("Local upload input must be a regular file");
  if (info.size > maxBytes) throw new Error(`File exceeds maximum size of ${maxBytes} bytes`);
  const data = await readFile(resolved);
  if (data.byteLength > maxBytes) throw new Error(`File exceeds maximum size of ${maxBytes} bytes`);
  return { path: resolved, data, size: data.byteLength };
}

/** Strict, size-bounded base64 decoder. */
export function decodeBase64(input: string, maxBytes: number): Buffer {
  const compact = input.replace(/\s/g, "");
  if (!compact || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(compact)) {
    throw new Error("Invalid base64 data");
  }
  const estimated = Math.floor(compact.length * 3 / 4);
  if (estimated > maxBytes + 2) throw new Error(`Decoded file exceeds maximum size of ${maxBytes} bytes`);
  const data = Buffer.from(compact, "base64");
  if (data.byteLength > maxBytes) throw new Error(`Decoded file exceeds maximum size of ${maxBytes} bytes`);
  return data;
}
