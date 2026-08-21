import type { ToolDefinition } from "../../definition.js";
import { getQueryTool } from "./get_query.js";
import { runQueryTool } from "./run_query.js";
import { createQueryTool } from "./create_query.js";
import { updateQueryTool } from "./update_query.js";
import { deleteQueryTool } from "./delete_query.js";

export {
  getQueryTool,
  runQueryTool,
  createQueryTool,
  updateQueryTool,
  deleteQueryTool,
};

export const dataExplorerTools = [
  getQueryTool,
  runQueryTool,
  createQueryTool,
  updateQueryTool,
  deleteQueryTool,
] as const satisfies readonly ToolDefinition[];
