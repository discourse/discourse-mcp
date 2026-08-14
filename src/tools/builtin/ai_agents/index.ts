import { z } from "zod";
import { defineTool } from "../../definition.js";
import { jsonError, jsonResponse, rateLimit, zodError, isZodError } from "../../../util/json_response.js";
import { aiAdminError, AI_AGENTS_BASE, deleteSuccess, requireAiAdmin, requireAiAdminWrite, stripSecretBindings } from "../discourse_ai/common.js";
import { agentImportBundleSchema, aiAgentIdSchema, createAgentPayloadSchema, updateAgentPayloadSchema } from "./schema.js";

const idSchema = z.object({ id: aiAgentIdSchema }).strict();
const updateSchema = z.object({ id: aiAgentIdSchema, ...updateAgentPayloadSchema.shape }).strict();
const listSchema = z.object({ view: z.enum(["slim", "full"]).default("slim") }).strict();

function conciseText(value: unknown, maxLength = 180) {
  if (typeof value !== "string") return value ?? null;
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

export function slimAgentIndex(raw: any) {
  const agents = Array.isArray(raw?.ai_agents) ? raw.ai_agents : [];
  const meta = raw?.meta && typeof raw.meta === "object" ? raw.meta : {};
  return {
    ai_agents: agents.map((agent: any) => ({
      id: agent.id,
      name: agent.name,
      description: conciseText(agent.description),
      description_truncated: (typeof agent.description === "string" && agent.description.length > 180) || undefined,
      enabled: agent.enabled,
      system: agent.system,
      priority: agent.priority,
      default_llm_id: agent.default_llm_id ?? null,
      user_id: agent.user_id ?? agent.user?.id ?? null,
      allowed_group_ids: Array.isArray(agent.allowed_group_ids) ? agent.allowed_group_ids : [],
      tool_count: Array.isArray(agent.tools) ? agent.tools.length : 0,
      mcp_server_count: Array.isArray(agent.mcp_server_ids) ? agent.mcp_server_ids.length : 0,
      features: Array.isArray(agent.features) ? agent.features.map((feature: any) => ({ id: feature.id, module_name: feature.module_name, name: feature.name })) : [],
    })),
    meta: {
      tools: Array.isArray(meta.tools) ? meta.tools.map((tool: any) => ({ id: tool.id, name: tool.name, native: tool.native === true || undefined, token_count: tool.token_count })) : [],
      llms: Array.isArray(meta.llms) ? meta.llms.map((llm: any) => ({ id: llm.id, name: llm.name, vision_enabled: llm.vision_enabled, supported_native_tools: llm.supported_native_tools })) : [],
      mcp_servers: Array.isArray(meta.mcp_servers) ? meta.mcp_servers.map((server: any) => ({ id: server.id, name: server.name, tool_count: server.tool_count, last_health_status: server.last_health_status })) : [],
      settings: meta.settings ?? {},
    },
    total: agents.length,
    detail_tool: "discourse_ai_get_agent",
  };
}

export const listAiAgentsTool = defineTool({
  name: "discourse_ai_list_agents",
  title: "List AI Agents",
  description: "List concise Discourse AI agent summaries and slim tool/model metadata. Defaults to slim; use discourse_ai_get_agent to load one full configuration, or view=full only when the complete index is explicitly needed. Requires admin credentials.",
  schema: listSchema,
  availability: "always",
  toolsets: ["ai_agents", "ai_features"],
  handler: async (input, _extra, ctx) => {
    const access = requireAiAdmin(ctx.siteState); if (access) return access;
    try {
      const { view } = listSchema.parse(input);
      const raw = await ctx.siteState.ensureSelectedSite().client.get(`${AI_AGENTS_BASE}.json`);
      return jsonResponse(view === "full" ? raw : slimAgentIndex(raw));
    }
    catch (error) { return isZodError(error) ? zodError(error) : aiAdminError("list AI agents", error); }
  },
});

export const getAiAgentTool = defineTool({
  name: "discourse_ai_get_agent", title: "Get AI Agent",
  description: "Get the full editable configuration of one Discourse AI agent. Custom tools use custom-<id>; native tools use native-<id> in tool tuples.",
  schema: idSchema,
  availability: "always", toolsets: ["ai_agents"],
  handler: async (input, _extra, ctx) => {
    const access = requireAiAdmin(ctx.siteState); if (access) return access;
    try { const { id } = idSchema.parse(input); return jsonResponse(await ctx.siteState.ensureSelectedSite().client.get(`${AI_AGENTS_BASE}/${id}/edit.json`)); }
    catch (error) { return aiAdminError("get AI agent", error); }
  },
});

export const createAiAgentTool = defineTool({
  name: "discourse_ai_create_agent", title: "Create AI Agent",
  description: "Create a typed Discourse AI agent. Requires admin credentials and write mode. Tool entries may be names or [name, options, force] tuples.",
  schema: createAgentPayloadSchema,
  availability: "writes_enabled", toolsets: ["ai_agents"],
  handler: async (input, _extra, ctx, opts) => {
    const access = requireAiAdminWrite(ctx.siteState, opts); if (access) return access;
    try { const payload = createAgentPayloadSchema.parse(input); await rateLimit("ai-agent-create"); return jsonResponse(await ctx.siteState.ensureSelectedSite().client.post(`${AI_AGENTS_BASE}.json`, { ai_agent: payload })); }
    catch (error) { return isZodError(error) ? zodError(error) : aiAdminError("create AI agent", error); }
  },
});

export const updateAiAgentTool = defineTool({
  name: "discourse_ai_update_agent", title: "Update AI Agent",
  description: "Partially update one AI agent, including enabled state, permissions, model, prompt, tools, and RAG configuration. Only supplied fields are sent. Requires admin credentials and write mode.",
  schema: updateSchema,
  availability: "writes_enabled", toolsets: ["ai_agents"],
  handler: async (input, _extra, ctx, opts) => {
    const access = requireAiAdminWrite(ctx.siteState, opts); if (access) return access;
    try {
      const { id, ...supplied } = updateSchema.parse(input);
      if (!Object.keys(supplied).length) return jsonError("Provide at least one agent field to update");
      const client = ctx.siteState.ensureSelectedSite().client;
      const payload: Record<string, unknown> = { ...supplied };
      const preserveRagUploads = supplied.rag_uploads === undefined;
      const preserveMcpToolNames = supplied.mcp_server_ids !== undefined && supplied.mcp_server_tool_names === undefined;
      // Current Discourse clears linked RAG uploads when this key is omitted,
      // and clears selected MCP tool names when server IDs are submitted without
      // their names map. Read once and fail closed before either partial update.
      if (preserveRagUploads || preserveMcpToolNames) {
        const current = await client.get(`${AI_AGENTS_BASE}/${id}/edit.json`) as any;
        if (!current?.ai_agent) return jsonError("Could not read current agent configuration; refusing to update because the partial update could be destructive");
        if (preserveRagUploads) {
          if (!Array.isArray(current.ai_agent.rag_uploads)) return jsonError("Could not read current agent RAG uploads; refusing to update because Discourse would clear them");
          const ids = current.ai_agent.rag_uploads.map((upload: any) => upload?.id);
          if (ids.some((uploadId: unknown) => !Number.isInteger(uploadId) || Number(uploadId) <= 0)) return jsonError("Current agent returned invalid RAG upload IDs; refusing to update");
          payload.rag_uploads = ids.map((uploadId: number) => ({ id: uploadId }));
        }
        if (preserveMcpToolNames) {
          const names = current.ai_agent.mcp_server_tool_names;
          if (!names || typeof names !== "object" || Array.isArray(names)) return jsonError("Could not read current MCP server tool selections; refusing to update because Discourse would clear them");
          payload.mcp_server_tool_names = names;
        }
      }
      await rateLimit("ai-agent-update");
      return jsonResponse(await client.put(`${AI_AGENTS_BASE}/${id}.json`, { ai_agent: payload }));
    }
    catch (error) { return isZodError(error) ? zodError(error) : aiAdminError("update AI agent", error); }
  },
});

export const deleteAiAgentTool = defineTool({
  name: "discourse_ai_delete_agent", title: "Delete AI Agent",
  description: "Delete a non-system AI agent. Requires admin credentials and write mode.", schema: idSchema,
  availability: "writes_enabled", toolsets: ["ai_agents"], annotations: { destructiveHint: true },
  handler: async (input, _extra, ctx, opts) => {
    const access = requireAiAdminWrite(ctx.siteState, opts); if (access) return access;
    try { const { id } = idSchema.parse(input); await rateLimit("ai-agent-delete"); await ctx.siteState.ensureSelectedSite().client.delete(`${AI_AGENTS_BASE}/${id}.json`); return jsonResponse(deleteSuccess("agent", id)); }
    catch (error) { return aiAdminError("delete AI agent", error); }
  },
});

export const createAiAgentUserTool = defineTool({
  name: "discourse_ai_create_agent_user", title: "Create AI Agent User",
  description: "Explicitly create the bot user used by an AI agent for mention/chat entry points. Requires admin credentials and write mode.", schema: idSchema,
  availability: "writes_enabled", toolsets: ["ai_agents"],
  handler: async (input, _extra, ctx, opts) => {
    const access = requireAiAdminWrite(ctx.siteState, opts); if (access) return access;
    try { const { id } = idSchema.parse(input); await rateLimit("ai-agent-user"); return jsonResponse(await ctx.siteState.ensureSelectedSite().client.post(`${AI_AGENTS_BASE}/${id}/create-user.json`, {})); }
    catch (error) { return aiAdminError("create AI agent user", error); }
  },
});

export const exportAiAgentTool = defineTool({
  name: "discourse_ai_export_agent", title: "Export AI Agent",
  description: "Export a portable AI agent bundle. It may include referenced custom-tool definitions but excludes secret bindings. Treat prompts and scripts as sensitive.", schema: idSchema,
  availability: "always", toolsets: ["ai_agents"],
  handler: async (input, _extra, ctx) => {
    const access = requireAiAdmin(ctx.siteState); if (access) return access;
    try { const { id } = idSchema.parse(input); return jsonResponse(stripSecretBindings(await ctx.siteState.ensureSelectedSite().client.get(`${AI_AGENTS_BASE}/${id}/export.json`))); }
    catch (error) { return aiAdminError("export AI agent", error); }
  },
});

const importSchema = z.object({ bundle: agentImportBundleSchema, force: z.boolean().default(false), confirm_force: z.boolean().default(false) }).strict();
export const importAiAgentTool = defineTool({
  name: "discourse_ai_import_agent", title: "Import AI Agent",
  description: "Import a portable AI agent bundle. The bundle may create or overwrite embedded custom tools. force requires confirm_force=true. Requires admin credentials and write mode.", schema: importSchema,
  availability: "writes_enabled", toolsets: ["ai_agents"], annotations: { destructiveHint: true },
  handler: async (input, _extra, ctx, opts) => {
    const access = requireAiAdminWrite(ctx.siteState, opts); if (access) return access;
    try { const parsed = importSchema.parse(input); if (parsed.force && !parsed.confirm_force) return jsonError("force=true requires confirm_force=true because it can overwrite the agent and embedded custom tools"); await rateLimit("ai-agent-import"); return jsonResponse(await ctx.siteState.ensureSelectedSite().client.post(`${AI_AGENTS_BASE}/import.json`, { ...parsed.bundle, force: parsed.force })); }
    catch (error) { return isZodError(error) ? zodError(error) : aiAdminError("import AI agent", error); }
  },
});

export const aiAgentTools = [listAiAgentsTool, getAiAgentTool, createAiAgentTool, updateAiAgentTool, deleteAiAgentTool, createAiAgentUserTool, exportAiAgentTool, importAiAgentTool] as const;
