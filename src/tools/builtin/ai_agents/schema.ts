import { z } from "zod";

export const aiAgentIdSchema = z.union([
  z.number().int().refine((value) => value !== 0, "Agent ID must be nonzero"),
  z.string().regex(/^-?[1-9]\d*$/, "Agent ID must be a nonzero integer"),
]);

const nullablePositiveId = z.number().int().positive().nullable();
const uploadSchema = z.object({ id: z.number().int().positive() }).strict();
const toolOptionsSchema = z.record(z.unknown()).nullable();
export const agentToolSchema = z.union([
  z.string().min(1),
  z.tuple([z.string().min(1), toolOptionsSchema.optional(), z.boolean().optional()]),
]);

const thinkingEffortSchema = z.enum([
  "default", "none", "minimal", "low", "medium", "high", "xhigh", "max",
]).nullable();

export const agentPayloadShape = {
  name: z.string().min(1).max(100),
  description: z.string().min(1).max(2000),
  system_prompt: z.string().min(1).max(10_000_000),
  enabled: z.boolean(),
  priority: z.boolean(),
  default_llm_id: nullablePositiveId,
  top_p: z.number().min(0).max(1).nullable(),
  temperature: z.number().min(0).nullable(),
  thinking_effort: thinkingEffortSchema,
  force_default_llm: z.boolean(),
  allowed_group_ids: z.array(z.number().int().nonnegative()),
  user_id: nullablePositiveId,
  allow_chat_channel_mentions: z.boolean(),
  allow_chat_direct_messages: z.boolean(),
  allow_topic_mentions: z.boolean(),
  allow_personal_messages: z.boolean(),
  tools: z.array(agentToolSchema),
  mcp_server_ids: z.array(z.number().int().positive()),
  mcp_server_tool_names: z.record(z.array(z.string().min(1))),
  subagent_ids: z.array(aiAgentIdSchema)
    .refine((ids) => new Set(ids.map(String)).size <= 20, "At most 20 unique subagent IDs are allowed")
    .describe("Up to 20 existing AI agent IDs this agent may delegate to; IDs may include negative system-agent IDs"),
  forced_tool_count: z.number().int().min(-1).max(100_000),
  require_approval: z.boolean(),
  response_format: z.array(z.record(z.unknown())).nullable(),
  examples: z.array(z.tuple([z.string(), z.string()])),
  show_thinking: z.boolean(),
  vision_enabled: z.boolean(),
  vision_max_pixels: z.number().int().positive().max(4_000_000),
  rag_chunk_tokens: z.number().int().min(1).max(50_000),
  rag_chunk_overlap_tokens: z.number().int().min(0).max(200),
  rag_conversation_chunks: z.number().int().min(1).max(1000),
  rag_llm_model_id: nullablePositiveId,
  rag_uploads: z.array(uploadSchema),
  max_turn_tokens: z.number().int().positive().max(10_000_000).nullable(),
  compression_threshold: z.number().int().min(20).max(99),
} as const;

export const createAgentPayloadSchema = z.object({
  ...Object.fromEntries(Object.entries(agentPayloadShape).map(([key, value]) => [key, value.optional()])),
  name: agentPayloadShape.name,
  description: agentPayloadShape.description,
  system_prompt: agentPayloadShape.system_prompt,
}).strict();

export const updateAgentPayloadSchema = z.object(agentPayloadShape).partial().strict();

export const agentImportBundleSchema = z.record(z.unknown()).refine(
  (value) => (value.agent !== null && typeof value.agent === "object" && !Array.isArray(value.agent)) || (value.persona !== null && typeof value.persona === "object" && !Array.isArray(value.persona)),
  "Agent import bundle must contain an agent or persona object",
);
