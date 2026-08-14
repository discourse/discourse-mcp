import test from "node:test";
import assert from "node:assert/strict";
import { aiAgentTools } from "../tools/builtin/ai_agents/index.js";
import { aiCustomToolTools } from "../tools/builtin/ai_custom_tools/index.js";
import { aiFeatureTools } from "../tools/builtin/ai_features/index.js";
import { Logger } from "../util/logger.js";
import { SiteState } from "../site/state.js";
import type { ToolContext, ToolRegistrationOptions } from "../tools/types.js";
import { registerAllTools } from "../tools/registry.js";
import { registerAllResources, type ResourceRegistrar } from "../resources/registry.js";
import { BUILTIN_TOOLSETS } from "../tools/toolsets.js";
import { isBlockedSetting, validateSettingValue } from "../tools/builtin/ai_features/settings.js";
import { aiAdminError } from "../tools/builtin/discourse_ai/common.js";
import { HttpError } from "../http/client.js";

const logger = new Logger("silent");
const allAiTools = [...aiAgentTools, ...aiCustomToolTools, ...aiFeatureTools];
function harness(auth = true) {
  const siteState = new SiteState({ logger, timeoutMs: 5000, defaultAuth: auth ? { type: "api_key", key: "secret", username: "system" } : { type: "none" } });
  siteState.selectSite("https://forum.example.com");
  const ctx = { server: { registerTool() { return {} as never; } }, siteState, logger, maxReadLength: 50000 } as unknown as ToolContext;
  const opts: ToolRegistrationOptions = { allowWrites: true, toolsMode: "discourse_api_only", toolsets: ["ai_agents", "ai_custom_tools", "ai_features"] };
  const invoke = async (name: string, input: unknown) => {
    const tool = allAiTools.find((candidate) => candidate.name === name); assert.ok(tool, `missing tool ${name}`);
    return tool.handler(input as never, {} as never, ctx, opts);
  };
  return { siteState, ctx, opts, invoke };
}
function body(result: any) { return JSON.parse(result.content[0].text); }

function mockToolServer() {
  const names: string[] = [];
  return { names, server: { registerTool(name: string) { names.push(name); return {}; } } as any };
}

test("AI toolsets are default-off, independently selectable, ordered, and de-duplicate agent discovery", async () => {
  const siteState = new SiteState({ logger, timeoutMs: 5000, defaultAuth: { type: "none" } });
  const defaults = mockToolServer(); await registerAllTools(defaults.server, siteState, logger, { allowWrites: true, toolsMode: "discourse_api_only" });
  assert.equal(defaults.names.some((name) => name.startsWith("discourse_ai_")), false);

  const features = mockToolServer(); await registerAllTools(features.server, siteState, logger, { allowWrites: false, toolsMode: "discourse_api_only", toolsets: ["ai_features"] });
  assert.deepEqual(features.names, ["discourse_select_site", "discourse_ai_list_agents", "discourse_ai_list_features", "discourse_ai_get_feature_config"]);

  const all = mockToolServer(); await registerAllTools(all.server, siteState, logger, { allowWrites: true, toolsMode: "discourse_api_only", toolsets: ["ai_agents", "ai_custom_tools", "ai_features"] });
  assert.equal(all.names.filter((name) => name === "discourse_ai_list_agents").length, 1);
  assert.equal(all.names.filter((name) => name.startsWith("discourse_ai_")).length, 20);
});

test("agent list is slim by default and full only when explicitly requested", async () => {
  const original = globalThis.fetch;
  const longDescription = "D".repeat(400);
  const upstream = {
    ai_agents: [{ id: 1, name: "Helper", description: longDescription, enabled: true, system: true, priority: true, system_prompt: "very large private prompt", tools: [["Search", null, false], ["custom-4", {}, true]], allowed_group_ids: [10], mcp_server_ids: [2], mcp_server_tool_names: { "2": ["lookup"] }, subagent_ids: [3, -14], subagent_tool_token_count: 120, features: [{ id: 7, module_name: "bot", name: "bot" }], user: { id: 22, username: "helper" } }],
    meta: { tools: [{ id: "Search", name: "Search", help: "large help text", options: { query: { description: "large schema" } }, token_count: 50 }], llms: [{ id: 3, name: "Model", vision_enabled: true, supported_native_tools: ["web_search"], extra: "omit" }], mcp_servers: [{ id: 2, name: "Server", tool_count: 8, last_health_status: "healthy", tools: ["large"] }], settings: { rag_images_enabled: true } },
  };
  globalThis.fetch = async () => Response.json(upstream);
  try {
    const { invoke } = harness(); const slim = body(await invoke("discourse_ai_list_agents", {}));
    assert.equal(slim.total, 1); assert.equal(slim.detail_tool, "discourse_ai_get_agent");
    assert.equal(slim.ai_agents[0].system_prompt, undefined); assert.equal(slim.ai_agents[0].tools, undefined); assert.equal(slim.ai_agents[0].tool_count, 2); assert.equal(slim.ai_agents[0].subagent_count, 2); assert.equal(slim.ai_agents[0].subagent_ids, undefined);
    assert.equal(slim.ai_agents[0].description.length, 180); assert.equal(slim.ai_agents[0].description_truncated, true);
    assert.equal(slim.meta.tools[0].help, undefined); assert.equal(slim.meta.tools[0].options, undefined); assert.equal(slim.meta.mcp_servers[0].tools, undefined);
    const full = body(await invoke("discourse_ai_list_agents", { view: "full" })); assert.equal(full.ai_agents[0].system_prompt, "very large private prompt"); assert.ok(full.meta.tools[0].options);
  } finally { globalThis.fetch = original; }
});

test("system agents with negative IDs can be loaded by the detail tool", async () => {
  const original = globalThis.fetch; let requested = "";
  globalThis.fetch = async (input) => { requested = String(input); return Response.json({ ai_agent: { id: -14, name: "System Agent" } }); };
  try {
    const result = body(await harness().invoke("discourse_ai_get_agent", { id: "-14" }));
    assert.equal(result.ai_agent.id, -14); assert.match(requested, /ai-agents\/-14\/edit\.json$/);
  } finally { globalThis.fetch = original; }
});

test("custom-tool authoring resource is conditional and returns the exact live empty_tool script", async () => {
  const { siteState } = harness(); const resources: Record<string, unknown[]> = {};
  const server = { resource(name: string, ...args: unknown[]) { resources[name] = args; } } as ResourceRegistrar;
  registerAllResources(server, { siteState, logger }); assert.equal(resources.ai_custom_tools_authoring_guide, undefined);
  registerAllResources(server, { siteState, logger }, { toolsets: ["ai_custom_tools"] });
  assert.ok(resources.ai_custom_tools_authoring_guide);
  const allResources: Record<string, unknown[]> = {};
  registerAllResources({ resource(name: string, ...args: unknown[]) { allResources[name] = args; } } as ResourceRegistrar, { siteState, logger }, { toolsets: [...BUILTIN_TOOLSETS] });
  assert.ok(allResources.ai_custom_tools_authoring_guide);
  const original = globalThis.fetch; const script = "/* live preamble */\nfunction invoke(parameters) { return parameters; }";
  globalThis.fetch = async () => Response.json({ meta: { presets: [{ preset_id: "empty_tool", script }] } });
  try {
    const callback = resources.ai_custom_tools_authoring_guide[2] as (uri: URL) => Promise<any>;
    const result = await callback(new URL("discourse://ai/custom-tools/authoring-guide"));
    assert.equal(result.contents[0].mimeType, "text/javascript"); assert.equal(result.contents[0].text, script);
  } finally { globalThis.fetch = original; }
});

test("guide preamble and preset catalog use live content while slim lists omit scripts and bindings", async () => {
  const original = globalThis.fetch; const script = "/* preamble */ function invoke(p) { return p; }";
  globalThis.fetch = async () => Response.json({
    ai_tools: [{ id: 1, name: "Sensitive", tool_name: "sensitive", description: "D".repeat(400), summary: "Short", parameters: [{ name: "query", type: "string", required: true, description: "very long parameter documentation" }], secret_contracts: [{ alias: "api_key" }], script: "secret source", secret_bindings: [{ alias: "key", ai_secret_id: 2 }], rag_uploads: [{ id: 9 }] }],
    meta: { presets: [{ preset_id: "empty_tool", preset_name: "Blank", parameters: [{ name: "url", type: "string", required: true, description: "verbose preset parameter help" }], script }, { preset_id: "category", category: "images" }], llms: [{ id: 3, name: "Model", verbose: "omit" }], ai_secrets: [{ id: 2, name: "API key", value: "must omit" }] },
  });
  try {
    const { invoke } = harness(); const preamble = body(await invoke("discourse_ai_get_custom_tool_guide", { topic: "preamble" }));
    assert.equal(preamble.text, script); assert.equal(preamble.source.resource_uri, "discourse://ai/custom-tools/authoring-guide");
    const listed = body(await invoke("discourse_ai_list_custom_tools", {}));
    assert.equal(listed.total, 1); assert.equal(listed.detail_tool, "discourse_ai_get_custom_tool");
    assert.equal(listed.ai_tools[0].script, undefined); assert.equal(listed.ai_tools[0].secret_bindings, undefined); assert.equal(listed.ai_tools[0].secret_bindings_configured, true);
    assert.equal(listed.ai_tools[0].description.length, 180); assert.deepEqual(listed.ai_tools[0].parameters, [{ name: "query", type: "string", required: true }]); assert.equal(listed.ai_tools[0].rag_upload_count, 1);
    assert.equal(listed.meta.presets[0].script, undefined); assert.deepEqual(listed.meta.presets[0].parameters, [{ name: "url", type: "string", required: true }]); assert.equal(listed.meta.presets[0].parameters[0].description, undefined);
    assert.deepEqual(listed.meta.ai_secrets, [{ id: 2, name: "API key" }]);
    const category: any = await invoke("discourse_ai_get_custom_tool_guide", { topic: "presets", preset_id: "category" }); assert.equal(category.isError, true);
  } finally { globalThis.fetch = original; }
});

test("agent create and partial update send exact wrappers and preserve omitted RAG uploads", async () => {
  const original = globalThis.fetch; const requests: Array<{ url: string; method: string; body?: any }> = [];
  globalThis.fetch = async (input, init) => { const url = String(input); const method = init?.method ?? "GET"; const parsed = init?.body ? JSON.parse(String(init.body)) : undefined; requests.push({ url, method, body: parsed }); if (method === "GET") return Response.json({ ai_agent: { rag_uploads: [{ id: 9 }] } }); return Response.json({ ai_agent: { id: 4 } }, { status: method === "POST" ? 201 : 200 }); };
  try {
    const { invoke } = harness(); await invoke("discourse_ai_create_agent", { name: "Agent", description: "Description", system_prompt: "Prompt", tools: [["custom-2", { option: true }, true]], subagent_ids: [7, "-14"] });
    await invoke("discourse_ai_update_agent", { id: 4, enabled: false, allowed_group_ids: [3, 11], subagent_ids: [8] });
    assert.equal(requests[0].url.endsWith("/admin/plugins/discourse-ai/ai-agents.json"), true); assert.equal(requests[0].body.ai_agent.name, "Agent"); assert.deepEqual(requests[0].body.ai_agent.subagent_ids, [7, "-14"]);
    assert.deepEqual(requests.slice(1).map((item) => item.method), ["GET", "PUT"]); assert.deepEqual(requests[2].body, { ai_agent: { enabled: false, allowed_group_ids: [3, 11], subagent_ids: [8], rag_uploads: [{ id: 9 }] } });
  } finally { globalThis.fetch = original; }
});

test("agent subagent schema enforces nonzero IDs and upstream limit", async () => {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({}); };
  try {
    const { invoke } = harness();
    const tooMany: any = await invoke("discourse_ai_create_agent", {
      name: "Agent", description: "Description", system_prompt: "Prompt",
      subagent_ids: Array.from({ length: 21 }, (_, index) => index + 1),
    });
    assert.equal(tooMany.isError, true); assert.match(body(tooMany).error, /Validation failed/);
    const invalid: any = await invoke("discourse_ai_update_agent", { id: 4, subagent_ids: [0] });
    assert.equal(invalid.isError, true); assert.match(body(invalid).error, /Validation failed/);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});

test("agent update preserves MCP server tool selections when only server IDs change", async () => {
  const original = globalThis.fetch; const requests: Array<{ method: string; body?: any }> = [];
  globalThis.fetch = async (_input, init) => { const method = init?.method ?? "GET"; const parsed = init?.body ? JSON.parse(String(init.body)) : undefined; requests.push({ method, body: parsed }); if (method === "GET") return Response.json({ ai_agent: { rag_uploads: [{ id: 9 }], mcp_server_tool_names: { "1": ["search"], "2": [] } } }); return Response.json({ ai_agent: { id: 4 } }); };
  try {
    await harness().invoke("discourse_ai_update_agent", { id: 4, mcp_server_ids: [1, 2], rag_uploads: [{ id: 9 }] });
    assert.deepEqual(requests.map((request) => request.method), ["GET", "PUT"]);
    assert.deepEqual(requests[1].body.ai_agent, { mcp_server_ids: [1, 2], rag_uploads: [{ id: 9 }], mcp_server_tool_names: { "1": ["search"], "2": [] } });
  } finally { globalThis.fetch = original; }
});

test("custom-tool execution uses the API's persisted and unsaved body variants", async () => {
  const original = globalThis.fetch; const bodies: any[] = [];
  globalThis.fetch = async (_input, init) => { bodies.push(JSON.parse(String(init?.body))); return Response.json({ output: "ok" }); };
  try {
    const { invoke } = harness(); await invoke("discourse_ai_test_custom_tool", { id: 2, parameters: { q: "x" } });
    await invoke("discourse_ai_test_custom_tool", { id: 2, parameters: {}, script: "function invoke() { return 1; }", secret_bindings: [{ alias: "api", ai_secret_id: 7 }] });
    assert.deepEqual(bodies[0], { parameters: { q: "x" } }); assert.equal(bodies[1].ai_tool.script.includes("invoke"), true); assert.deepEqual(bodies[1].ai_tool.secret_bindings, [{ alias: "api", ai_secret_id: 7 }]);
  } finally { globalThis.fetch = original; }
});

test("feature metadata accepts round-tripped scalar strings without exposing credentials", () => {
  assert.equal(validateSettingValue({ setting: "enabled", type: "boolean" }, "false"), null);
  assert.equal(validateSettingValue({ setting: "limit", type: "integer", min: 1, max: 10 }, "5"), null);
  assert.match(validateSettingValue({ setting: "limit", type: "integer" }, "5.5") ?? "", /integer/);
  assert.equal(isBlockedSetting({ setting: "ai_discord_app_public_key", secret: false }), false);
  assert.equal(isBlockedSetting({ setting: "ai_bot_github_access_token", secret: true }), true);
  assert.equal(isBlockedSetting({ setting: "provider_api_key", secret: false }), true);
});

test("structured AI admin errors preserve object details", () => {
  const result = aiAdminError("update", new HttpError(422, "unprocessable", { errors: { setting: ["is invalid"] } }));
  assert.match(body(result).error, /\{"setting":\["is invalid"\]\}/);
});

test("feature update enforces exact-area settings, conflicts, secret denial, bulk shape, and refresh", async () => {
  const original = globalThis.fetch; const requests: Array<{ url: string; method: string; body?: any }> = [];
  globalThis.fetch = async (input, init) => { const url = String(input); const method = init?.method ?? "GET"; const parsed = init?.body ? JSON.parse(String(init.body)) : undefined; requests.push({ url, method, body: parsed });
    if (url.includes("ai-features.json")) return Response.json([{ id: 1, module_name: "summarization", module_enabled: true, features: [] }]);
    if (url.includes("ai-features/1/edit.json")) return Response.json({ id: 1, module_name: "summarization", module_enabled: true, features: [] });
    if (url.includes("site_settings.json")) return Response.json({ site_settings: [{ setting: "ai_summarization_enabled", type: "bool", value: "false", secret: false }, { setting: "ai_bot_github_access_token", type: "string", value: "do-not-expose", secret: true }] });
    return new Response(null, { status: 204 });
  };
  try {
    const { invoke } = harness(); const got = body(await invoke("discourse_ai_get_feature_config", { module_id: 1 })); assert.deepEqual(got.blocked_settings, [{ setting: "ai_bot_github_access_token", reason: "Credential/secret settings are outside this tool's scope" }]); assert.equal(JSON.stringify(got).includes("do-not-expose"), false);
    const stale: any = await invoke("discourse_ai_update_feature_config", { module_id: 1, settings: { ai_summarization_enabled: true }, original_values: { ai_summarization_enabled: true } }); assert.equal(stale.isError, true); assert.match(body(stale).error, /changed since/);
    await invoke("discourse_ai_update_feature_config", { module_id: 1, settings: { ai_summarization_enabled: true }, original_values: { ai_summarization_enabled: false } });
    const put = requests.find((item) => item.method === "PUT"); assert.deepEqual(put?.body, { settings: { ai_summarization_enabled: { value: "true" } } }); assert.match(put?.url ?? "", /bulk_update\.json$/);
    const arbitrary: any = await invoke("discourse_ai_update_feature_config", { module_id: 1, settings: { ai_other_feature: true } }); assert.equal(arbitrary.isError, true); assert.match(body(arbitrary).error, /not editable in exact area/);
    const secret: any = await invoke("discourse_ai_update_feature_config", { module_id: 1, settings: { ai_bot_github_access_token: "replacement" } }); assert.equal(secret.isError, true); assert.match(body(secret).error, /not editable in exact area/);
  } finally { globalThis.fetch = original; }
});

test("resource and RAG-preserving updates fail closed when live prerequisites are unavailable", async () => {
  const unauthenticated = harness(false); const resources: Record<string, unknown[]> = {};
  registerAllResources({ resource(name: string, ...args: unknown[]) { resources[name] = args; } } as ResourceRegistrar, { siteState: unauthenticated.siteState, logger }, { toolsets: ["ai_custom_tools"] });
  const callback = resources.ai_custom_tools_authoring_guide[2] as (uri: URL) => Promise<any>;
  await assert.rejects(() => callback(new URL("discourse://ai/custom-tools/authoring-guide")), /admin API credentials/);

  const original = globalThis.fetch; const methods: string[] = [];
  globalThis.fetch = async (_input, init) => { methods.push(init?.method ?? "GET"); return Response.json({}); };
  try {
    const authenticated = harness(); const liveResources: Record<string, unknown[]> = {};
    registerAllResources({ resource(name: string, ...args: unknown[]) { liveResources[name] = args; } } as ResourceRegistrar, { siteState: authenticated.siteState, logger }, { toolsets: ["ai_custom_tools"] });
    const liveCallback = liveResources.ai_custom_tools_authoring_guide[2] as (uri: URL) => Promise<any>;
    await assert.rejects(() => liveCallback(new URL("discourse://ai/custom-tools/authoring-guide")), /Unknown live preset 'empty_tool'/);
    methods.length = 0;
    const badAgent: any = await authenticated.invoke("discourse_ai_update_agent", { id: 4, enabled: false });
    assert.equal(badAgent.isError, true); assert.match(body(badAgent).error, /refusing to update/); assert.deepEqual(methods, ["GET"]);
    methods.length = 0;
    const badTool: any = await harness().invoke("discourse_ai_update_custom_tool", { id: 5, summary: "changed" });
    assert.equal(badTool.isError, true); assert.match(body(badTool).error, /refusing to update/); assert.deepEqual(methods, ["GET"]);
  } finally { globalThis.fetch = original; }
});

test("guide emits required security and stale-reference warnings", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ meta: { presets: [{ preset_id: "empty_tool", script: "function invoke() { return http.head('https://example.com'); }" }] } });
  try {
    const { invoke } = harness();
    for (const topic of ["http", "secrets", "discourse"] as const) {
      const response = body(await invoke("discourse_ai_get_custom_tool_guide", { topic }));
      assert.ok(response.security_warnings.length > 0); assert.match(response.security_warnings.join(" "), /non-admin|SystemUser|SSRF|credential/i);
    }
    const limits = body(await invoke("discourse_ai_get_custom_tool_guide", { topic: "limits" })); assert.ok(limits.apis.includes("sleep(milliseconds) -> void (blocking synchronous helper)"));
    const presets = body(await invoke("discourse_ai_get_custom_tool_guide", { topic: "presets" }));
    assert.equal(presets.reference_may_be_stale, true); assert.equal(presets.stale_references[0].capability, "http.head");
    const tolerant = body(await invoke("discourse_ai_get_custom_tool_guide", { topic: "http", preset_id: "empty_tool", include_example: true })); assert.equal(tolerant.topic, "http"); assert.equal(tolerant.source.preset_id, undefined);
  } finally { globalThis.fetch = original; }
});

test("confirmed imports send exact force-aware wire bodies", async () => {
  const original = globalThis.fetch; const requests: any[] = [];
  globalThis.fetch = async (input, init) => { requests.push({ url: String(input), body: JSON.parse(String(init?.body)) }); return Response.json({ success: true }); };
  try {
    const { invoke } = harness();
    await invoke("discourse_ai_import_agent", { bundle: { agent: { name: "Portable" }, custom_tools: [] }, force: true, confirm_force: true });
    await invoke("discourse_ai_import_custom_tool", { ai_tool: { name: "Tool", tool_name: "tool", description: "Description", summary: "Summary", script: "function invoke() { return 1; }", id: 99 }, force: true, confirm_force: true });
    assert.deepEqual(requests[0].body, { agent: { name: "Portable" }, custom_tools: [], force: true });
    assert.equal(requests[1].body.force, true); assert.equal(requests[1].body.ai_tool.id, undefined);
  } finally { globalThis.fetch = original; }
});

test("delete, export, force confirmation, and write gates preserve safety contracts", async () => {
  const original = globalThis.fetch; const requests: Array<{ method: string; body?: any }> = [];
  globalThis.fetch = async (_input, init) => { requests.push({ method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined }); if ((init?.method ?? "GET") === "GET") return Response.json({ ai_tool: { id: 2, name: "Tool", secret_bindings: [{ alias: "x", ai_secret_id: 9 }] } }); return new Response(null, { status: 204, headers: { "Content-Type": "application/json" } }); };
  try {
    const h = harness(); const deleted = body(await h.invoke("discourse_ai_delete_custom_tool", { id: 2 })); assert.deepEqual(deleted, { success: true, deleted: true, kind: "custom_tool", id: 2 });
    const exported = body(await h.invoke("discourse_ai_export_custom_tool", { id: 2 })); assert.equal(exported.ai_tool.secret_bindings, undefined);
    const forced: any = await h.invoke("discourse_ai_import_custom_tool", { ai_tool: { name: "T", tool_name: "t", description: "D", summary: "S", script: "function invoke() { return 1; }" }, force: true }); assert.equal(forced.isError, true); assert.match(body(forced).error, /confirm_force/);
    const before = requests.length; h.opts.allowWrites = false; const blocked: any = await h.invoke("discourse_ai_delete_agent", { id: 1 }); assert.equal(blocked.isError, true); assert.equal(requests.length, before);
  } finally { globalThis.fetch = original; }
});

test("a representative AI handler rejects missing admin auth before HTTP", async () => {
  const original = globalThis.fetch; let called = false; globalThis.fetch = async () => { called = true; return Response.json({}); };
  try { const result: any = await harness(false).invoke("discourse_ai_list_agents", {}); assert.equal(result.isError, true); assert.equal(called, false); }
  finally { globalThis.fetch = original; }
});
