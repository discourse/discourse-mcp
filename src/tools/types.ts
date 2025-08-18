import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HttpClient } from "../http/client.js";
import type { Logger } from "../util/logger.js";

export interface ToolContext {
  client: HttpClient;
  logger: Logger;
  siteBase: string;
}

export type RegisterFn = (server: McpServer, ctx: ToolContext, opts: { allowWrites: boolean }) => void | Promise<void>;

