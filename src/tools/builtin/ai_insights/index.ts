import type { ToolDefinition } from "../../definition.js";
import { aiGetTopicSummaryTool } from "./get_topic_summary.js";
import { aiSemanticSearchTool } from "./semantic_search.js";
import { aiListSentimentPostsTool } from "./list_sentiment_posts.js";

export { aiGetTopicSummaryTool, aiSemanticSearchTool, aiListSentimentPostsTool };
export const aiInsightTools = [aiGetTopicSummaryTool, aiSemanticSearchTool, aiListSentimentPostsTool] as const satisfies readonly ToolDefinition[];
