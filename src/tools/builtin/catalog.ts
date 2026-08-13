import type { ToolDefinition } from "../definition.js";
import { selectSiteTool } from "./select_site.js";
import { searchTool } from "./search.js";
import { filterTopicsTool } from "./filter_topics.js";
import { readTopicTool } from "./read_topic.js";
import { readPostTool } from "./read_post.js";
import { getUserTool } from "./get_user.js";
import { listUserPostsTool } from "./list_user_posts.js";
import { listUsersTool } from "./list_users.js";
import { getChatMessagesTool } from "./get_chat_messages.js";
import {
  getDraftTool,
  saveDraftTool,
  deleteDraftTool,
} from "./drafts.js";
import { createPostTool } from "./create_post.js";
import { createUserTool } from "./create_user.js";
import { createCategoryTool } from "./create_category.js";
import { createTopicTool } from "./create_topic.js";
import { updateTopicTool } from "./update_topic.js";
import { updatePostTool } from "./update_post.js";
import { updateUserTool } from "./update_user.js";
import { uploadFileTool } from "./upload_file.js";
import { dataExplorerTools } from "./data_explorer/index.js";

/** Built-in tools in their stable MCP registration order. */
export const builtinTools = [
  selectSiteTool,
  searchTool,
  filterTopicsTool,
  readTopicTool,
  readPostTool,
  getUserTool,
  listUserPostsTool,
  listUsersTool,
  getChatMessagesTool,
  getDraftTool,
  createPostTool,
  createUserTool,
  createCategoryTool,
  createTopicTool,
  updateTopicTool,
  updatePostTool,
  updateUserTool,
  uploadFileTool,
  saveDraftTool,
  deleteDraftTool,
  ...dataExplorerTools,
] as const satisfies readonly ToolDefinition[];
