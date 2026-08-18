import { getReviewQueueCountTool } from "./get_review_queue_count.js";
import { listReviewablesTool } from "./list_reviewables.js";
import { listReviewableTopicsTool } from "./list_reviewable_topics.js";
import { getReviewableTool } from "./get_reviewable.js";
import { performReviewableActionTool } from "./perform_reviewable_action.js";

/** Moderation tools in stable queue-workflow order: overview, list, topic list, detail, mutation. */
export const moderationTools = [
  getReviewQueueCountTool,
  listReviewablesTool,
  listReviewableTopicsTool,
  getReviewableTool,
  performReviewableActionTool,
] as const;
