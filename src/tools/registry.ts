import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Logger } from "../util/logger.js";
import type { SiteState } from "../site/state.js";
import { registerSearch } from "./builtin/search.js";
import { registerReadTopic } from "./builtin/read_topic.js";
import { registerReadPost } from "./builtin/read_post.js";
import { registerListCategories } from "./builtin/list_categories.js";
import { registerListTags } from "./builtin/list_tags.js";
import { registerGetUser } from "./builtin/get_user.js";
import { registerCreatePost } from "./builtin/create_post.js";
import { registerCreateCategory } from "./builtin/create_category.js";
import { registerCreateTopic } from "./builtin/create_topic.js";
import { registerSelectSite } from "./builtin/select_site.js";
import { registerFilterTopics } from "./builtin/filter_topics.js";
import { registerCreateUser } from "./builtin/create_user.js";
import { registerListUserPosts } from "./builtin/list_user_posts.js";
import { registerListChatChannels } from "./builtin/list_chat_channels.js";
import { registerListUserChatChannels } from "./builtin/list_user_chat_channels.js";
import { registerGetChatMessages } from "./builtin/get_chat_messages.js";
import {
  registerListDrafts,
  registerGetDraft,
  registerSaveDraft,
  registerDeleteDraft,
} from "./builtin/drafts.js";

export type ToolsMode = "auto" | "discourse_api_only" | "tool_exec_api";

export interface RegistryOptions {
  allowWrites: boolean;
  toolsMode: ToolsMode;
  // When true, do not register the discourse_select_site tool
  hideSelectSite?: boolean;
  // Optional default search prefix to add to all searches
  defaultSearchPrefix?: string;
}

export async function registerAllTools(
  server: McpServer,
  siteState: SiteState,
  logger: Logger,
  opts: RegistryOptions & { maxReadLength?: number }
) {
  const ctx = { siteState, logger, defaultSearchPrefix: opts.defaultSearchPrefix, maxReadLength: opts.maxReadLength ?? 50000 } as const;

  // Built-in tools
  if (!opts.hideSelectSite) {
    registerSelectSite(server, ctx, { allowWrites: false, toolsMode: opts.toolsMode });
  }
  registerSearch(server, ctx, { allowWrites: false });
  registerReadTopic(server, ctx, { allowWrites: false });
  registerReadPost(server, ctx, { allowWrites: false });
  registerListCategories(server, ctx, { allowWrites: false });
  registerListTags(server, ctx, { allowWrites: false });
  registerGetUser(server, ctx, { allowWrites: false });
  registerListUserPosts(server, ctx, { allowWrites: false });
  registerFilterTopics(server, ctx, { allowWrites: false });
  registerListChatChannels(server, ctx, { allowWrites: false });
  registerListUserChatChannels(server, ctx, { allowWrites: false });
  registerGetChatMessages(server, ctx, { allowWrites: false });
  registerCreatePost(server, ctx, { allowWrites: opts.allowWrites });
  registerCreateUser(server, ctx, { allowWrites: opts.allowWrites });
  registerCreateCategory(server, ctx, { allowWrites: opts.allowWrites });
  registerCreateTopic(server, ctx, { allowWrites: opts.allowWrites });

  // Draft tools - read operations always available, write operations conditional
  registerListDrafts(server, ctx, { allowWrites: false });
  registerGetDraft(server, ctx, { allowWrites: false });
  registerSaveDraft(server, ctx, { allowWrites: opts.allowWrites });
  registerDeleteDraft(server, ctx, { allowWrites: opts.allowWrites });
}
