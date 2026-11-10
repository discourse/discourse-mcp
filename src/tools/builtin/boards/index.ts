import type { ToolDefinition } from "../../definition.js";
import { listBoardsTool, getBoardTool, listTopicBoardsTool } from "./reads.js";
import { createBoardCardTool, moveBoardCardTool, updateBoardCardTool, deleteBoardCardTool } from "./cards.js";
import { createBoardColumnTool, updateBoardColumnTool, moveBoardColumnTool, clearBoardColumnTool, deleteBoardColumnTool } from "./columns.js";
import { createBoardTool, updateBoardTool, setBoardArchivedTool, deleteBoardTool } from "./boards.js";

export const boardTools = [
  listBoardsTool,
  getBoardTool,
  listTopicBoardsTool,
  createBoardCardTool,
  moveBoardCardTool,
  updateBoardCardTool,
  deleteBoardCardTool,
  createBoardColumnTool,
  updateBoardColumnTool,
  moveBoardColumnTool,
  clearBoardColumnTool,
  deleteBoardColumnTool,
  createBoardTool,
  updateBoardTool,
  setBoardArchivedTool,
  deleteBoardTool,
] as const satisfies readonly ToolDefinition[];
