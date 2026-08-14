import { z } from "zod";
import { defineTool } from "../../definition.js";
import { jsonError, jsonResponse, rateLimit, zodError, isZodError } from "../../../util/json_response.js";
import { aiAdminError, AI_TOOLS_BASE, aiIdSchema, deleteSuccess, requireAiAdmin, requireAiAdminWrite, stripSecretBindings } from "../discourse_ai/common.js";
import { buildGuideResponse, fetchCustomToolIndex, slimCustomToolIndex } from "./guide.js";
import { createCustomToolPayloadSchema, customToolImportSchema, secretBindingSchema, updateCustomToolPayloadSchema } from "./schema.js";

const idSchema = z.object({ id: aiIdSchema }).strict();
const guideSchema = z.object({
  topic: z.enum(["overview", "preamble", "entrypoints", "parameters", "http", "llm", "rag", "uploads", "chain", "secrets", "discourse", "context", "crypto", "limits", "security", "presets"]).default("overview").describe("Focused guide section. Use presets to browse or retrieve live preset examples."),
  preset_id: z.string().min(1).optional().describe("Optional live preset ID used only when topic=presets; ignored for every other topic."),
});

export const getCustomToolGuideTool = defineTool({
  name: "discourse_ai_get_custom_tool_guide", title: "Get AI Custom Tool Guide",
  description: "Retrieve one focused MiniRacer authoring topic. Usually pass only topic. preset_id is optional and used only with topic=presets to load one live example; extra preset_id values on other topics are ignored. Requires admin credentials.", schema: guideSchema,
  availability: "always", toolsets: ["ai_custom_tools"],
  handler: async (input, _extra, ctx) => {
    const access = requireAiAdmin(ctx.siteState); if (access) return access;
    try { const parsed = guideSchema.parse(input); return jsonResponse(await buildGuideResponse(ctx.siteState, parsed.topic, parsed.preset_id)); }
    catch (error) { return isZodError(error) ? zodError(error) : aiAdminError("get custom-tool guide", error); }
  },
});

export const listCustomToolsTool = defineTool({
  name: "discourse_ai_list_custom_tools", title: "List AI Custom Tools",
  description: "List concise database-backed custom-tool summaries and compact live preset metadata. Scripts, bindings, verbose parameter descriptions, and full records are omitted; use discourse_ai_get_custom_tool or the guide's preset lookup to zoom in. Requires admin credentials.", schema: z.object({}).strict(),
  availability: "always", toolsets: ["ai_custom_tools"],
  handler: async (_input, _extra, ctx) => { const access = requireAiAdmin(ctx.siteState); if (access) return access; try { return jsonResponse(slimCustomToolIndex(await fetchCustomToolIndex(ctx.siteState))); } catch (error) { return aiAdminError("list custom tools", error); } },
});

export const getCustomToolTool = defineTool({
  name: "discourse_ai_get_custom_tool", title: "Get AI Custom Tool",
  description: "Get one database-backed scripted AI tool, including source and configured secret bindings. Treat the response as sensitive. Requires admin credentials.", schema: idSchema,
  availability: "always", toolsets: ["ai_custom_tools"],
  handler: async (input, _extra, ctx) => { const access = requireAiAdmin(ctx.siteState); if (access) return access; try { const { id } = idSchema.parse(input); return jsonResponse(await ctx.siteState.ensureSelectedSite().client.get(`${AI_TOOLS_BASE}/${id}/edit.json`)); } catch (error) { return aiAdminError("get custom tool", error); } },
});

export const createCustomToolTool = defineTool({
  name: "discourse_ai_create_custom_tool", title: "Create AI Custom Tool",
  description: "Create a database-backed synchronous MiniRacer scripted tool. Call discourse_ai_get_custom_tool_guide before authoring. Never provide raw secret values. Requires admin credentials and write mode.", schema: createCustomToolPayloadSchema,
  availability: "writes_enabled", toolsets: ["ai_custom_tools"],
  handler: async (input, _extra, ctx, opts) => { const access = requireAiAdminWrite(ctx.siteState, opts); if (access) return access; try { const payload = createCustomToolPayloadSchema.parse(input); await rateLimit("ai-tool-create"); return jsonResponse(await ctx.siteState.ensureSelectedSite().client.post(`${AI_TOOLS_BASE}.json`, { ai_tool: payload })); } catch (error) { return isZodError(error) ? zodError(error) : aiAdminError("create custom tool", error); } },
});

const updateSchema = z.object({ id: aiIdSchema, ...updateCustomToolPayloadSchema.shape }).strict();
export const updateCustomToolTool = defineTool({
  name: "discourse_ai_update_custom_tool", title: "Update AI Custom Tool",
  description: "Partially update a scripted tool. Call the guide before substantial script changes. Omitted scalar fields and RAG uploads are preserved; changing secret_contracts can prune orphan bindings unless secret_bindings are supplied. Raw secret values are never accepted. Requires admin credentials and write mode.", schema: updateSchema,
  availability: "writes_enabled", toolsets: ["ai_custom_tools"],
  handler: async (input, _extra, ctx, opts) => {
    const access = requireAiAdminWrite(ctx.siteState, opts); if (access) return access;
    try {
      const { id, ...supplied } = updateSchema.parse(input);
      if (!Object.keys(supplied).length) return jsonError("Provide at least one custom-tool field to update");
      const client = ctx.siteState.ensureSelectedSite().client; let payload = supplied;
      if (supplied.rag_uploads === undefined) {
        const current = await client.get(`${AI_TOOLS_BASE}/${id}/edit.json`) as any;
        if (!current?.ai_tool || !Array.isArray(current.ai_tool.rag_uploads)) return jsonError("Could not read current custom-tool RAG uploads; refusing to update because Discourse would clear them");
        const ids = current.ai_tool.rag_uploads.map((upload: any) => upload?.id);
        if (ids.some((uploadId: unknown) => !Number.isInteger(uploadId) || Number(uploadId) <= 0)) return jsonError("Current custom tool returned invalid RAG upload IDs; refusing to update");
        payload = { ...supplied, rag_uploads: ids.map((uploadId: number) => ({ id: uploadId })) };
      }
      await rateLimit("ai-tool-update"); return jsonResponse(await client.put(`${AI_TOOLS_BASE}/${id}.json`, { ai_tool: payload }));
    } catch (error) { return isZodError(error) ? zodError(error) : aiAdminError("update custom tool", error); }
  },
});

export const deleteCustomToolTool = defineTool({
  name: "discourse_ai_delete_custom_tool", title: "Delete AI Custom Tool",
  description: "Delete a scripted tool. Agents referencing it may stop functioning as configured. Requires admin credentials and write mode.", schema: idSchema,
  availability: "writes_enabled", toolsets: ["ai_custom_tools"], annotations: { destructiveHint: true },
  handler: async (input, _extra, ctx, opts) => { const access = requireAiAdminWrite(ctx.siteState, opts); if (access) return access; try { const { id } = idSchema.parse(input); await rateLimit("ai-tool-delete"); await ctx.siteState.ensureSelectedSite().client.delete(`${AI_TOOLS_BASE}/${id}.json`); return jsonResponse(deleteSuccess("custom_tool", id)); } catch (error) { return aiAdminError("delete custom tool", error); } },
});

const testSchema = z.object({ id: aiIdSchema, parameters: z.record(z.unknown()).default({}), script: z.string().min(1).max(100_000).optional(), secret_bindings: z.array(secretBindingSchema).optional() }).strict();
export const testCustomToolTool = defineTool({
  name: "discourse_ai_test_custom_tool", title: "Test AI Custom Tool",
  description: "Actually execute a persisted or unsaved custom-tool script. It can make external requests and cause side effects; this is not dry validation. Requires admin credentials and write mode.", schema: testSchema,
  availability: "writes_enabled", toolsets: ["ai_custom_tools"],
  handler: async (input, _extra, ctx, opts) => { const access = requireAiAdminWrite(ctx.siteState, opts); if (access) return access; try { const parsed = testSchema.parse(input); const ai_tool = parsed.script !== undefined || parsed.secret_bindings !== undefined ? { ...(parsed.script !== undefined ? { script: parsed.script } : {}), ...(parsed.secret_bindings !== undefined ? { secret_bindings: parsed.secret_bindings } : {}) } : undefined; await rateLimit("ai-tool-test"); return jsonResponse(await ctx.siteState.ensureSelectedSite().client.post(`${AI_TOOLS_BASE}/${parsed.id}/test.json`, { parameters: parsed.parameters, ...(ai_tool ? { ai_tool } : {}) })); } catch (error) { return isZodError(error) ? zodError(error) : aiAdminError("test custom tool", error); } },
});

export const exportCustomToolTool = defineTool({
  name: "discourse_ai_export_custom_tool", title: "Export AI Custom Tool",
  description: "Export portable custom-tool JSON. Discourse excludes secret bindings; MCP also strips them defensively. Treat script source as sensitive. Requires admin credentials.", schema: idSchema,
  availability: "always", toolsets: ["ai_custom_tools"],
  handler: async (input, _extra, ctx) => { const access = requireAiAdmin(ctx.siteState); if (access) return access; try { const { id } = idSchema.parse(input); const raw = await ctx.siteState.ensureSelectedSite().client.get(`${AI_TOOLS_BASE}/${id}/export.json`); return jsonResponse(stripSecretBindings(raw)); } catch (error) { return aiAdminError("export custom tool", error); } },
});

export const importCustomToolTool = defineTool({
  name: "discourse_ai_import_custom_tool", title: "Import AI Custom Tool",
  description: "Import portable custom-tool JSON. force overwrites a matching tool_name and requires confirm_force=true. Secret IDs may be bound, but raw secret values are never accepted. Requires admin credentials and write mode.", schema: customToolImportSchema,
  availability: "writes_enabled", toolsets: ["ai_custom_tools"], annotations: { destructiveHint: true },
  handler: async (input, _extra, ctx, opts) => { const access = requireAiAdminWrite(ctx.siteState, opts); if (access) return access; try { const parsed = customToolImportSchema.parse(input); if (parsed.force && !parsed.confirm_force) return jsonError("force=true requires confirm_force=true because it overwrites an existing custom tool"); const { id: _id, created_by_id: _creator, created_at: _created, updated_at: _updated, ...portableTool } = parsed.ai_tool; await rateLimit("ai-tool-import"); return jsonResponse(await ctx.siteState.ensureSelectedSite().client.post(`${AI_TOOLS_BASE}/import.json`, { ai_tool: portableTool, force: parsed.force })); } catch (error) { return isZodError(error) ? zodError(error) : aiAdminError("import custom tool", error); } },
});

export const aiCustomToolTools = [getCustomToolGuideTool, listCustomToolsTool, getCustomToolTool, createCustomToolTool, updateCustomToolTool, deleteCustomToolTool, testCustomToolTool, exportCustomToolTool, importCustomToolTool] as const;
