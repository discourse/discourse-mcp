import test from "node:test";
import assert from "node:assert/strict";
import { workflowTools } from "../tools/builtin/workflows/index.js";
import { Logger } from "../util/logger.js";
import { SiteState } from "../site/state.js";
import type { ToolContext, ToolRegistrationOptions } from "../tools/types.js";

const logger = new Logger("silent");
function harness() {
  const siteState = new SiteState({ logger, timeoutMs: 5000, defaultAuth: { type: "api_key", key: "secret", username: "system" } });
  siteState.selectSite("https://forum.example.com");
  const ctx = { server: { registerTool() { return {} as never; } }, siteState, logger, maxReadLength: 50000 } as unknown as ToolContext;
  const opts: ToolRegistrationOptions = { allowWrites: true, toolsMode: "discourse_api_only", toolsets: ["workflows"] };
  const invoke = async (name: string, input: unknown) => {
    const tool = workflowTools.find((candidate) => candidate.name === name);
    assert.ok(tool, `missing tool ${name}`);
    return tool.handler(input as never, {} as never, ctx, opts);
  };
  return { invoke };
}
function body(result: any) { return JSON.parse(result.content[0].text); }

test("workflow list is slim and get adds a flat connection list", async () => {
  const original = globalThis.fetch; const urls: string[] = [];
  globalThis.fetch = async (input) => { const url = String(input); urls.push(url);
    if (url.includes("/workflows/12.json")) return Response.json({ workflow: { id: "12", name: "Full", nodes: [{ id: "a", name: "Start", type: "trigger:manual", parameters: { x: 1 } }, { id: "b", name: "Next", type: "action:log" }], connections: { Start: { main: [[{ node: "Next", type: "main", index: 0 }]] } }, pin_data: { Start: [] }, version_id: "v1" } });
    return Response.json({ workflows: [{ id: "12", name: "Full", nodes: [{ id: "a", name: "Start", type: "trigger:manual" }], connections: { huge: true }, static_data: { secret: false } }], meta: { total_rows_workflows: 1, load_more_workflows: "next" } });
  };
  try { const { invoke } = harness(); const listed = body(await invoke("discourse_list_workflows", { filter: "Full", cursor: "c" }));
    assert.equal(listed.workflows[0].connections, undefined); assert.deepEqual(listed.workflows[0].triggers, [{ id: "a", name: "Start", type: "trigger:manual" }]);
    assert.match(urls[0], /filter=Full/); assert.match(urls[0], /cursor=c/);
    const full = body(await invoke("discourse_get_workflow", { id: 12 })); assert.equal(full.version_id, "v1"); assert.equal(full.nodes[0].parameters.x, 1);
    assert.deepEqual(full.connection_list[0], { from: "Start", to: "Next", type: "main", output_index: 0, input_index: 0 });
  } finally { globalThis.fetch = original; }
});

test("workflow node catalog is slim unless an identifier is requested", async () => {
  const original = globalThis.fetch; globalThis.fetch = async () => Response.json({ node_types: [{ identifier: "condition:if", kind: "condition", label: "If", available: true, outputs: { true: {}, false: {} }, properties: [{ name: "leftValue" }], output_contracts: { true: { foo: "string" } }, examples: ["omit"] }] });
  try { const { invoke } = harness(); const slim = body(await invoke("discourse_list_workflow_node_types", {})); assert.deepEqual(slim.node_types[0].outputs, ["true", "false"]); assert.equal(slim.node_types[0].properties, undefined);
    const detail = body(await invoke("discourse_list_workflow_node_types", { identifier: "condition:if" })); assert.equal(detail.node_types[0].properties[0].name, "leftValue"); assert.equal(detail.node_types[0].examples, undefined);
  } finally { globalThis.fetch = original; }
});

test("workflow create converts flat connections and rejects an unpaired graph before HTTP", async () => {
  const original = globalThis.fetch; const requests: Array<{ method: string; body: any }> = [];
  globalThis.fetch = async (_input, init) => { requests.push({ method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined }); return Response.json({ workflow: { id: "1", name: "Small", nodes: [], connections: {} } }); };
  try { const { invoke } = harness(); const bad: any = await invoke("discourse_create_workflow", { name: "Bad", nodes: [] }); assert.equal(bad.isError, true); assert.equal(requests.length, 0);
    await invoke("discourse_create_workflow", { name: "Small", nodes: [{ id: "a", name: "Start", type: "trigger:manual" }, { id: "b", name: "Next", type: "action:log" }], connections: [{ from: "Start", to: "Next" }] });
    assert.deepEqual(requests[0].body.workflow.connections, { Start: { main: [[{ node: "Next", type: "main", index: 0 }]] } });
  } finally { globalThis.fetch = original; }
});

test("workflow update operations GET then PUT and publishing uses a separate body", async () => {
  const original = globalThis.fetch; const requests: Array<{ method: string; body: any }> = [];
  globalThis.fetch = async (_input, init) => { const method = init?.method ?? "GET"; const parsed = init?.body ? JSON.parse(String(init.body)) : undefined; requests.push({ method, body: parsed });
    if (method === "GET") return Response.json({ workflow: { id: "7", nodes: [{ id: "a", name: "Start", type: "trigger:manual" }], connections: {} } });
    return Response.json({ workflow: { id: "7", nodes: parsed.workflow.nodes ?? [], connections: parsed.workflow.connections ?? {}, published: parsed.workflow.published } });
  };
  try { const { invoke } = harness(); await invoke("discourse_update_workflow", { id: 7, operations: [{ op: "add_node", id: "b", node: { name: "Next", type: "action:log" } }, { op: "add_connection", from: "a", to: "b" }], published: true });
    assert.deepEqual(requests.map((request) => request.method), ["GET", "PUT", "PUT"]); assert.equal(requests[1].body.workflow.nodes.length, 2); assert.deepEqual(requests[2].body, { workflow: { published: true } });
  } finally { globalThis.fetch = original; }
});

test("workflow 404 gives the plugin/admin diagnostic", async () => {
  const original = globalThis.fetch; globalThis.fetch = async () => Response.json({ errors: ["not found"] }, { status: 404 });
  try { const result: any = await harness().invoke("discourse_get_workflow", { id: 99 }); assert.equal(result.isError, true); assert.match(body(result).error, /plugin disabled.*not found.*not admin/); }
  finally { globalThis.fetch = original; }
});
