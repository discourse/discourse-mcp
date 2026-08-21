export {
  searchTagGroupsTool,
  listTagGroupsTool,
  getTagGroupTool,
} from "./reads.js";
export {
  createTagGroupTool,
  updateTagGroupTool,
  deleteTagGroupTool,
} from "./mutations.js";

import {
  searchTagGroupsTool,
  listTagGroupsTool,
  getTagGroupTool,
} from "./reads.js";
import {
  createTagGroupTool,
  updateTagGroupTool,
  deleteTagGroupTool,
} from "./mutations.js";

/** Stable lifecycle order: public discovery, staff inventory/detail, then writes. */
export const tagGroupTools = [
  searchTagGroupsTool,
  listTagGroupsTool,
  getTagGroupTool,
  createTagGroupTool,
  updateTagGroupTool,
  deleteTagGroupTool,
] as const;
