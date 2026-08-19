import { getReviewQueueCountTool } from "./get_review_queue_count.js";
import { listReviewablesTool } from "./list_reviewables.js";
import { listReviewableTopicsTool } from "./list_reviewable_topics.js";
import { getReviewableTool } from "./get_reviewable.js";
import { performReviewableActionTool } from "./perform_reviewable_action.js";
import { getUserModerationSummaryTool } from "./get_user_moderation_summary.js";
import { getPostRevisionTool } from "./get_post_revision.js";

/** Moderation tools in stable queue-workflow order: overview, list, topic list, detail, supporting reads, mutation. */
export const moderationTools = [
  getReviewQueueCountTool,
  listReviewablesTool,
  listReviewableTopicsTool,
  getReviewableTool,
  getUserModerationSummaryTool,
  getPostRevisionTool,
  performReviewableActionTool,
] as const;
