import type { ToolDefinition } from "../../definition.js";
import { listPrivateMessagesTool } from "./list.js";
import { readPrivateMessageTool } from "./read.js";
import { createPrivateMessageTool } from "./create.js";
import { replyPrivateMessageTool } from "./reply.js";
import { inviteToPrivateMessageTool } from "./invite.js";

export const privateMessageTools = [
  listPrivateMessagesTool,
  readPrivateMessageTool,
  createPrivateMessageTool,
  replyPrivateMessageTool,
  inviteToPrivateMessageTool,
] as const satisfies readonly ToolDefinition[];
