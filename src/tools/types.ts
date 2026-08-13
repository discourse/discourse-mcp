import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Logger } from "../util/logger.js";
import type { SiteState } from "../site/state.js";
import type { BuiltinToolsetMembership } from "./toolsets.js";

/** Narrowed interface for tool registration - only requires registerTool method */
export type ToolRegistrar = Pick<McpServer, "registerTool">;

export type ToolsMode = "auto" | "discourse_api_only" | "tool_exec_api";

/** Options shared by the built-in tool registrar and every tool handler. */
export interface ToolRegistrationOptions {
  allowWrites: boolean;
  toolsMode: ToolsMode;
  // Built-in domains to expose. Undefined preserves the default catalog (excluding opt-in-only domains).
  toolsets?: BuiltinToolsetMembership;
  // When true, do not register the discourse_select_site tool
  hideSelectSite?: boolean;
  // Optional default search prefix to add to all searches
  defaultSearchPrefix?: string;
  // Allowed directories for local file uploads (if empty/undefined, local uploads are disabled)
  allowedUploadPaths?: string[];
  // When true, include email addresses in user information
  showEmails?: boolean;
  // Maximum number of characters to include when returning post content
  maxReadLength?: number;
}

export interface ToolContext {
  server: ToolRegistrar;
  siteState: SiteState;
  logger: Logger;
  defaultSearchPrefix?: string;
  // Maximum number of characters to include when returning post content
  maxReadLength: number;
  // Allowed directories for local file uploads (if empty, local uploads are disabled)
  allowedUploadPaths?: string[];
}
