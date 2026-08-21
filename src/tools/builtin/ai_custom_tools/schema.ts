import { z } from "zod";

export const customToolParameterSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["string", "number", "boolean", "array"]),
  description: z.string().min(1),
  required: z.boolean(),
  enum: z.array(z.union([z.string(), z.number()])).min(1).refine((items) => new Set(items.map(String)).size === items.length, "enum values must be unique").optional(),
}).strict();
export const secretContractSchema = z.object({ alias: z.string().min(1) }).strict();
export const secretBindingSchema = z.object({ alias: z.string().min(1), ai_secret_id: z.number().int().positive().nullable() }).strict();
const uploadSchema = z.object({ id: z.number().int().positive() }).strict();

export const customToolPayloadShape = {
  name: z.string().min(1),
  tool_name: z.string().min(1).regex(/^[a-zA-Z0-9_-]+$/, "tool_name may contain letters, numbers, underscore, and hyphen"),
  description: z.string().min(1),
  summary: z.string().min(1),
  script: z.string().min(1).max(100_000),
  parameters: z.array(customToolParameterSchema),
  secret_contracts: z.array(secretContractSchema),
  secret_bindings: z.array(secretBindingSchema),
  rag_chunk_tokens: z.number().int().min(1).max(50_000),
  rag_chunk_overlap_tokens: z.number().int().min(0).max(200),
  rag_llm_model_id: z.number().int().positive().nullable(),
  rag_uploads: z.array(uploadSchema),
} as const;

export const createCustomToolPayloadSchema = z.object({
  ...Object.fromEntries(Object.entries(customToolPayloadShape).map(([key, value]) => [key, value.optional()])),
  name: customToolPayloadShape.name,
  tool_name: customToolPayloadShape.tool_name,
  description: customToolPayloadShape.description,
  summary: customToolPayloadShape.summary,
  script: customToolPayloadShape.script,
}).strict();

export const updateCustomToolPayloadSchema = z.object(customToolPayloadShape).partial().strict();

export const customToolImportSchema = z.object({
  ai_tool: createCustomToolPayloadSchema.extend({
    id: z.number().int().positive().optional(),
    created_by_id: z.number().int().positive().optional(),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
  }),
  force: z.boolean().default(false),
  confirm_force: z.boolean().default(false),
}).strict();
