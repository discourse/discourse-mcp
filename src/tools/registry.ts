import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Logger } from "../util/logger.js";
import type { SiteState } from "../site/state.js";
import { registerSearch } from "./builtin/search.js";
import { registerReadTopic } from "./builtin/read_topic.js";
import { registerReadPost } from "./builtin/read_post.js";
import { registerGetUser } from "./builtin/get_user.js";
import { registerCreatePost } from "./builtin/create_post.js";
import { registerCreateCategory } from "./builtin/create_category.js";
import { registerCreateTopic } from "./builtin/create_topic.js";
import { registerSelectSite } from "./builtin/select_site.js";
import { registerFilterTopics } from "./builtin/filter_topics.js";
import { registerCreateUser } from "./builtin/create_user.js";
import { registerListUserPosts } from "./builtin/list_user_posts.js";
import { registerListUsers } from "./builtin/list_users.js";
import { registerUpdateUser } from "./builtin/update_user.js";
import { registerUploadFile } from "./builtin/upload_file.js";
import { registerGetChatMessages } from "./builtin/get_chat_messages.js";
import {
  registerGetDraft,
  registerSaveDraft,
  registerDeleteDraft,
} from "./builtin/drafts.js";

// Note: The following tools have been replaced by MCP Resources (v0.2.0):
// - discourse_list_categories → discourse://site/categories
// - discourse_list_tags → discourse://site/tags
// - discourse_list_chat_channels → discourse://chat/channels
// - discourse_list_user_chat_channels → discourse://user/chat-channels
// - discourse_list_drafts → discourse://user/drafts

export type ToolsMode = "auto" | "discourse_api_only" | "tool_exec_api";

export interface RegistryOptions {
  allowWrites: boolean;
  toolsMode: ToolsMode;
  // When true, do not register the discourse_select_site tool
  hideSelectSite?: boolean;
  // Optional default search prefix to add to all searches
  defaultSearchPrefix?: string;
  // Allowed directories for local file uploads (if empty/undefined, local uploads are disabled)
  allowedUploadPaths?: string[];
  // When true, admin-only tools (e.g., list_users) are registered
  hasAdminApiKey?: boolean;
}

export async function registerAllTools(
  server: McpServer,
  siteState: SiteState,
  logger: Logger,
  opts: RegistryOptions & { maxReadLength?: number }
) {
  const ctx = { siteState, logger, defaultSearchPrefix: opts.defaultSearchPrefix, maxReadLength: opts.maxReadLength ?? 50000, allowedUploadPaths: opts.allowedUploadPaths } as const;

  // Built-in tools (actions and parameterized queries)
  if (!opts.hideSelectSite) {
    registerSelectSite(server, ctx, { allowWrites: false, toolsMode: opts.toolsMode });
  }
  
  // Search and filter tools (parameterized queries)
  registerSearch(server, ctx, { allowWrites: false });
  registerFilterTopics(server, ctx, { allowWrites: false });
  
  // Read tools (parameterized lookups)
  registerReadTopic(server, ctx, { allowWrites: false });
  registerReadPost(server, ctx, { allowWrites: false });
  registerGetUser(server, ctx, { allowWrites: false });
  registerListUserPosts(server, ctx, { allowWrites: false });
  if (opts.hasAdminApiKey) {
    registerListUsers(server, ctx, { allowWrites: false });
  }
  registerGetChatMessages(server, ctx, { allowWrites: false });
  registerGetDraft(server, ctx, { allowWrites: false });
  
  // Write tools (state mutations)
  registerCreatePost(server, ctx, { allowWrites: opts.allowWrites });
  registerCreateUser(server, ctx, { allowWrites: opts.allowWrites });
  registerCreateCategory(server, ctx, { allowWrites: opts.allowWrites });
  registerCreateTopic(server, ctx, { allowWrites: opts.allowWrites });
  registerUpdateUser(server, ctx, { allowWrites: opts.allowWrites });
  registerUploadFile(server, ctx, { allowWrites: opts.allowWrites });
  registerSaveDraft(server, ctx, { allowWrites: opts.allowWrites });
  registerDeleteDraft(server, ctx, { allowWrites: opts.allowWrites });
}
