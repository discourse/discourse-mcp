import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HttpClient } from "../http/client.js";
import type { Logger } from "../util/logger.js";
import { registerSearch } from "./builtin/search.js";
import { registerReadTopic } from "./builtin/read_topic.js";
import { registerReadPost } from "./builtin/read_post.js";
import { registerListCategories } from "./builtin/list_categories.js";
import { registerListTags } from "./builtin/list_tags.js";
import { registerGetUser } from "./builtin/get_user.js";
import { registerCreatePost } from "./builtin/create_post.js";
import { tryRegisterRemoteTools } from "./remote/tool_exec_api.js";

export type ToolsMode = "auto" | "discourse_api_only" | "tool_exec_api";

export interface RegistryOptions {
  allowWrites: boolean;
  toolsMode: ToolsMode;
}

export async function registerAllTools(
  server: McpServer,
  client: HttpClient,
  logger: Logger,
  siteBase: string,
  opts: RegistryOptions
) {
  const ctx = { client, logger, siteBase } as const;

  // Built-in tools
  registerSearch(server, ctx, { allowWrites: false });
  registerReadTopic(server, ctx, { allowWrites: false });
  registerReadPost(server, ctx, { allowWrites: false });
  registerListCategories(server, ctx, { allowWrites: false });
  registerListTags(server, ctx, { allowWrites: false });
  registerGetUser(server, ctx, { allowWrites: false });
  registerCreatePost(server, ctx, { allowWrites: opts.allowWrites });

  // Remote tools
  if (opts.toolsMode !== "discourse_api_only") {
    if (opts.toolsMode === "auto") {
      await tryRegisterRemoteTools(server, client, logger, siteBase);
    } else if (opts.toolsMode === "tool_exec_api") {
      await tryRegisterRemoteTools(server, client, logger, siteBase);
      // In strict mode, consider throwing if none found (left as info log)
    }
  }
}

