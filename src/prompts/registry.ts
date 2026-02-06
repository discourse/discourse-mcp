/**
 * MCP Prompts Registry
 *
 * Registers prompts that provide guided workflows for common tasks.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SiteState } from "../site/state.js";
import type { Logger } from "../util/logger.js";
import {
  sqlQueryPromptName,
  sqlQueryPromptSchema,
  getSqlQueryPromptContent,
} from "./sql_query.js";

/** Narrowed interface for prompt registration */
export type PromptRegistrar = Pick<McpServer, "registerPrompt">;

export interface PromptContext {
  siteState: SiteState;
  logger: Logger;
  allowAdminTools?: boolean;
}

/**
 * Registers all MCP prompts.
 */
export function registerAllPrompts(
  server: PromptRegistrar,
  ctx: PromptContext
): void {
  // Only register SQL query prompt if admin tools allowed
  // Default to computed auth if not explicitly provided
  const allowAdminTools = ctx.allowAdminTools ?? ctx.siteState.hasAdminAuth();
  if (allowAdminTools) {
    registerSqlQueryPrompt(server, ctx);
  }
}

function registerSqlQueryPrompt(
  server: PromptRegistrar,
  _ctx: PromptContext
): void {
  server.registerPrompt(
    sqlQueryPromptName,
    {
      description:
        "Guided workflow for database queries: discover schema, write SQL, run queries via Data Explorer",
      argsSchema: sqlQueryPromptSchema.shape,
    },
    async (args) => {
      const parsed = sqlQueryPromptSchema.safeParse(args);
      const validArgs = parsed.success ? parsed.data : {};

      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: getSqlQueryPromptContent(validArgs),
            },
          },
        ],
      };
    }
  );
}
