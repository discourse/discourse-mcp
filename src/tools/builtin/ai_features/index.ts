import { z } from "zod";
import { defineTool } from "../../definition.js";
import { jsonResponse, rateLimit, zodError, isZodError } from "../../../util/json_response.js";
import { aiAdminError, AI_FEATURES_BASE, aiIdSchema, requireAiAdmin, requireAiAdminWrite } from "../discourse_ai/common.js";
import { buildBulkUpdate, featureModules, fetchFeatureConfig, settingValueSchema } from "./settings.js";

const moduleSchema = z.object({ module_id: aiIdSchema }).strict();
function routingGuidance(moduleName: string) {
  if (moduleName === "bot") return "Bot agent membership is derived from agent mention/chat/PM permissions; change those with discourse_ai_update_agent. Other exact-area bot settings remain editable here.";
  if (moduleName === "spam") return "Spam configuration uses the dedicated Discourse AI spam API and is outside this toolset.";
  if (moduleName === "automation_reports" || moduleName === "automation_triage") return "Automation assignments live in Discourse Automation records and are outside this toolset.";
  return undefined;
}

export const listAiFeaturesTool = defineTool({
  name: "discourse_ai_list_features", title: "List AI Features",
  description: "List visible computed Discourse AI modules, feature enabled state, assigned agents, and effective LLMs. Requires admin credentials.", schema: z.object({}).strict(),
  availability: "always", toolsets: ["ai_features"],
  handler: async (_input, _extra, ctx) => { const access = requireAiAdmin(ctx.siteState); if (access) return access; try { const raw = await ctx.siteState.ensureSelectedSite().client.get(`${AI_FEATURES_BASE}.json`); return jsonResponse({ ai_features: featureModules(raw) }); } catch (error) { return aiAdminError("list AI features", error); } },
});

export const getAiFeatureConfigTool = defineTool({
  name: "discourse_ai_get_feature_config", title: "Get AI Feature Configuration",
  description: "Resolve a visible feature module ID and return its computed state plus editable settings from its exact ai-features/<module> area. Credential settings are omitted. Requires admin credentials.", schema: moduleSchema,
  availability: "always", toolsets: ["ai_features"],
  handler: async (input, _extra, ctx) => { const access = requireAiAdmin(ctx.siteState); if (access) return access; try { const { module_id } = moduleSchema.parse(input); const config = await fetchFeatureConfig(ctx.siteState.ensureSelectedSite().client, module_id); const name = String((config.module as any)?.module_name ?? ""); return jsonResponse({ ...config, routing_guidance: routingGuidance(name) }); } catch (error) { return isZodError(error) ? zodError(error) : aiAdminError("get AI feature configuration", error); } },
});

const valuesRecord = z.record(settingValueSchema);
const updateSchema = z.object({ module_id: aiIdSchema, settings: valuesRecord.refine((value) => Object.keys(value).length > 0, "Provide at least one setting"), original_values: valuesRecord.optional() }).strict();
export const updateAiFeatureConfigTool = defineTool({
  name: "discourse_ai_update_feature_config", title: "Update AI Feature Configuration",
  description: "Atomically bulk-update only non-secret settings freshly exposed by one exact AI feature area, with optional compare-before-write original_values. Refreshes effective state afterward. Production behavior changes immediately. Requires admin credentials and write mode.", schema: updateSchema,
  availability: "writes_enabled", toolsets: ["ai_features"],
  handler: async (input, _extra, ctx, opts) => {
    const access = requireAiAdminWrite(ctx.siteState, opts); if (access) return access;
    try {
      const parsed = updateSchema.parse(input); const client = ctx.siteState.ensureSelectedSite().client;
      const before = await fetchFeatureConfig(client, parsed.module_id); const moduleName = String((before.module as any)?.module_name ?? "");
      if ((moduleName === "spam" || moduleName.startsWith("automation_")) && before.settings.length === 0) throw new Error(routingGuidance(moduleName) ?? `Module '${moduleName}' exposes no editable settings in area '${before.area}'.`);
      const body = buildBulkUpdate(before, parsed.settings, parsed.original_values);
      await rateLimit("ai-feature-settings"); await client.put("/admin/site_settings/bulk_update.json", body);
      const refreshed = await fetchFeatureConfig(client, parsed.module_id);
      return jsonResponse({ success: true, updated_settings: Object.keys(parsed.settings), ...refreshed, routing_guidance: routingGuidance(moduleName) });
    } catch (error) { return isZodError(error) ? zodError(error) : aiAdminError("update AI feature configuration", error); }
  },
});

export const aiFeatureTools = [listAiFeaturesTool, getAiFeatureConfigTool, updateAiFeatureConfigTool] as const;
