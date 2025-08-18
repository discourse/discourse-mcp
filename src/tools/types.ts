import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Logger } from "../util/logger.js";
import type { SiteState } from "../site/state.js";

export interface ToolContext {
  siteState: SiteState;
  logger: Logger;
}

export type RegisterFn = (server: McpServer, ctx: ToolContext, opts: { allowWrites: boolean; toolsMode?: string }) => void | Promise<void>;

