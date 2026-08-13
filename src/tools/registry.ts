import type { Logger } from "../util/logger.js";
import type { SiteState } from "../site/state.js";
import {
  type ToolContext,
  type ToolRegistrar,
  type ToolRegistrationOptions,
} from "./types.js";
import { registerToolDefinitions } from "./definition.js";
import { builtinTools } from "./builtin/catalog.js";

export type {
  ToolRegistrationOptions,
  ToolsMode,
} from "./types.js";

/** @deprecated Import ToolRegistrationOptions from ./types.js instead. */
export type RegistryOptions = ToolRegistrationOptions;

// Note: The following tools have been replaced by MCP Resources (v0.2.0):
// - discourse_list_categories → discourse://site/categories
// - discourse_list_tags → discourse://site/tags
// - discourse_list_chat_channels → discourse://chat/channels
// - discourse_list_user_chat_channels → discourse://user/chat-channels
// - discourse_list_drafts → discourse://user/drafts

export async function registerAllTools(
  server: ToolRegistrar,
  siteState: SiteState,
  logger: Logger,
  opts: ToolRegistrationOptions
): Promise<void> {
  const ctx: ToolContext = {
    server,
    siteState,
    logger,
    defaultSearchPrefix: opts.defaultSearchPrefix,
    maxReadLength: opts.maxReadLength ?? 50000,
    allowedUploadPaths: opts.allowedUploadPaths,
  };

  const registeredNames = new Set(
    registerToolDefinitions(builtinTools, ctx, opts)
  );

  for (const toolset of opts.toolsets ?? []) {
    const contributed = builtinTools.some(
      (tool) =>
        tool.toolsets.includes(toolset) && registeredNames.has(tool.name)
    );
    if (!contributed) {
      logger.info(
        `Toolset '${toolset}' registered no tools under the current write/tether configuration.`
      );
    }
  }

  if (opts.toolsets && opts.toolsMode !== "discourse_api_only") {
    logger.info(
      "Built-in toolsets do not filter remote tools; use --tools_mode discourse_api_only for a closed built-in tool list."
    );
  }
}
