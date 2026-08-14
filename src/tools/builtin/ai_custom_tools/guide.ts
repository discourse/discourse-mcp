import { z } from "zod";
import type { SiteState } from "../../../site/state.js";
import { GUIDE_REFERENCE_REVISION, GUIDE_RESOURCE_URI, GUIDE_RUNTIME, GUIDE_SECTIONS, KNOWN_BRIDGE_METHODS } from "./guide_data.js";
import { AI_TOOLS_BASE } from "../discourse_ai/common.js";

export const guideTopicSchema = z.enum(["overview", "preamble", "entrypoints", "parameters", "http", "llm", "rag", "uploads", "chain", "secrets", "discourse", "context", "crypto", "limits", "security", "presets"]);
export type GuideTopic = z.infer<typeof guideTopicSchema>;

export interface LivePreset { preset_id?: string; preset_name?: string; category?: string; script?: string; [key: string]: unknown }
export interface CustomToolIndex { ai_tools?: unknown[]; meta?: { presets?: LivePreset[]; [key: string]: unknown } }

export async function fetchCustomToolIndex(siteState: SiteState): Promise<CustomToolIndex> {
  return await siteState.ensureSelectedSite().client.get(`${AI_TOOLS_BASE}.json`) as CustomToolIndex;
}

export function findLivePreset(index: CustomToolIndex, presetId: string): LivePreset {
  const presets = Array.isArray(index.meta?.presets) ? index.meta.presets : [];
  const preset = presets.find((item) => item?.preset_id === presetId);
  if (!preset) throw new Error(`Unknown live preset '${presetId}'`);
  if (typeof preset.script !== "string" || !preset.script) throw new Error(`Preset '${presetId}' is a category or has no script example`);
  return preset;
}

export async function loadLiveAuthoringGuide(siteState: SiteState) {
  const index = await fetchCustomToolIndex(siteState);
  const preset = findLivePreset(index, "empty_tool");
  return { text: preset.script as string, preset, index };
}

function conciseText(value: unknown, maxLength = 180) {
  if (typeof value !== "string") return value ?? null;
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function slimParameters(value: unknown) {
  return Array.isArray(value) ? value.map((parameter: any) => ({ name: parameter?.name, type: parameter?.type, required: parameter?.required === true })) : [];
}

function slimPreset(preset: LivePreset) {
  const parameters = slimParameters(preset.parameters);
  const contracts = Array.isArray(preset.secret_contracts) ? preset.secret_contracts : [];
  return {
    preset_id: preset.preset_id,
    preset_name: preset.preset_name,
    name: preset.name,
    tool_name: preset.tool_name,
    summary: conciseText(preset.summary),
    category: preset.category,
    parameter_count: parameters.length,
    parameters,
    secret_aliases: contracts.map((contract: any) => contract?.alias).filter(Boolean),
    has_script: typeof preset.script === "string" && preset.script.length > 0,
  };
}

function scriptCapabilities(script: string): string[] {
  const withoutComments = script.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
  const calls = [...withoutComments.matchAll(/\b(http|llm|index|upload|chain|secrets|discourse|crypto)\.([A-Za-z_$][\w$]*)\s*\(/g)].map((match) => `${match[1]}.${match[2]}`);
  if (/\bsleep\s*\(/.test(withoutComments)) calls.push("global.sleep");
  return calls;
}

function staleWarnings(presets: LivePreset[]) {
  const warnings: Array<{ kind: string; preset_id?: string; capability?: string; message: string }> = [];
  for (const preset of presets) {
    if (!preset.preset_id || typeof preset.script !== "string") continue;
    for (const capability of new Set(scriptCapabilities(preset.script))) {
      if (!KNOWN_BRIDGE_METHODS.has(capability)) warnings.push({ kind: "unknown_runtime_capability", preset_id: preset.preset_id, capability, message: "The selected Discourse server exposes a runtime capability absent from the bundled focused guide." });
    }
  }
  return warnings;
}

export async function buildGuideResponse(siteState: SiteState, topic: GuideTopic, presetId?: string) {
  if (topic === "preamble") {
    const live = await loadLiveAuthoringGuide(siteState);
    return { topic, runtime: GUIDE_RUNTIME, reference_revision: GUIDE_REFERENCE_REVISION, text: live.text, source: { kind: "live_server", resource_uri: GUIDE_RESOURCE_URI, preset_id: "empty_tool", discourse_paths: ["plugins/discourse-ai/lib/ai_tool_scripts/preamble.js", "plugins/discourse-ai/lib/ai_tool_scripts/presets/empty_tool.js"] } };
  }
  if (topic === "presets") {
    const index = await fetchCustomToolIndex(siteState);
    const presets = Array.isArray(index.meta?.presets) ? index.meta.presets : [];
    const warnings = staleWarnings(presets);
    const selected = presetId ? findLivePreset(index, presetId) : undefined;
    return { topic, runtime: GUIDE_RUNTIME, reference_revision: GUIDE_REFERENCE_REVISION, summary: selected ? `Live preset ${presetId}` : "Live preset catalog; request one preset_id for its full script", apis: [], constraints: [], security_warnings: [], examples: selected ? [selected.script] : [], preset: selected, presets: selected ? undefined : presets.map(slimPreset), source: { kind: "live_server", resource_uri: GUIDE_RESOURCE_URI, preset_id: presetId, discourse_paths: ["plugins/discourse-ai/app/models/ai_tool.rb", "plugins/discourse-ai/lib/ai_tool_scripts/presets/"] }, reference_may_be_stale: warnings.length > 0 || undefined, stale_references: warnings.length ? warnings : undefined };
  }
  const data = GUIDE_SECTIONS[topic];
  return { topic, runtime: GUIDE_RUNTIME, reference_revision: GUIDE_REFERENCE_REVISION, ...data, source: { kind: "bundled_mcp_reference", resource_uri: GUIDE_RESOURCE_URI, discourse_paths: ["plugins/discourse-ai/lib/ai_tool_scripts/preamble.js", "plugins/discourse-ai/lib/agents/tool_runner.rb", "plugins/discourse-ai/lib/agents/tool_runner/"] } };
}

export function slimCustomToolIndex(index: CustomToolIndex) {
  const tools = Array.isArray(index.ai_tools) ? index.ai_tools.map((raw) => {
    const tool = raw as Record<string, any>;
    const parameters = slimParameters(tool.parameters);
    const contracts = Array.isArray(tool.secret_contracts) ? tool.secret_contracts : [];
    return {
      id: tool.id,
      name: tool.name,
      tool_name: tool.tool_name,
      description: conciseText(tool.description),
      summary: conciseText(tool.summary),
      parameter_count: parameters.length,
      parameters,
      secret_aliases: contracts.map((contract: any) => contract?.alias).filter(Boolean),
      secret_bindings_configured: Array.isArray(tool.secret_bindings) && tool.secret_bindings.length > 0,
      rag_upload_count: Array.isArray(tool.rag_uploads) ? tool.rag_uploads.length : 0,
      has_script: typeof tool.script === "string" && tool.script.length > 0,
      updated_at: tool.updated_at,
    };
  }) : [];
  const meta = index.meta ?? {};
  return {
    ai_tools: tools,
    meta: {
      presets: Array.isArray(meta.presets) ? meta.presets.map(slimPreset) : [],
      llms: Array.isArray(meta.llms) ? meta.llms.map((llm: any) => ({ id: llm.id, name: llm.name })) : [],
      ai_secrets: Array.isArray(meta.ai_secrets) ? meta.ai_secrets.map((secret: any) => ({ id: secret.id, name: secret.name })) : [],
      settings: meta.settings ?? {},
    },
    total: tools.length,
    detail_tool: "discourse_ai_get_custom_tool",
    preset_detail: "discourse_ai_get_custom_tool_guide with topic=presets and preset_id",
  };
}
