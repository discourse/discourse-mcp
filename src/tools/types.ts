import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Logger } from "../util/logger.js";
import type { SiteState } from "../site/state.js";

/** Narrowed interface for tool registration - only requires registerTool method */
export type ToolRegistrar = Pick<McpServer, "registerTool">;

export interface ToolContext {
  siteState: SiteState;
  logger: Logger;
  defaultSearchPrefix?: string;
  // Maximum number of characters to include when returning post content
  maxReadLength: number;
  // Allowed directories for local file uploads (if empty, local uploads are disabled)
  allowedUploadPaths?: string[];
}

export type RegisterFn = (server: ToolRegistrar, ctx: ToolContext, opts: { allowWrites: boolean; allowAdminTools?: boolean; toolsMode?: string, showEmails?: boolean }) => void | Promise<void>;

