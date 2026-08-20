import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Logger } from "../util/logger.js";
import { SiteState } from "../site/state.js";
import type { ToolContext, ToolRegistrationOptions } from "../tools/types.js";
import { webhookTools } from "../tools/builtin/webhooks/index.js";

const logger = new Logger("silent");
function harness(auth = true, site = "https://hooks.example.com") {
  const siteState = new SiteState({ logger, timeoutMs: 5_000, defaultAuth: auth ? { type: "api_key", key: "key", username: "system" } : { type: "none" } }); siteState.selectSite(site);
  const ctx = { server: {} as any, siteState, logger, maxReadLength: 50_000, allowedUploadPaths: [] } satisfies ToolContext;
  const opts = { allowWrites: true, toolsMode: "discourse_api_only", toolsets: ["webhooks"] } satisfies ToolRegistrationOptions;
  const invoke = (name: string, input: Record<string, unknown>) => webhookTools.find((tool) => tool.name === name)!.handler(input as never, {} as never, ctx, opts);
  return { invoke };
}
function body(result: any) { return JSON.parse(result.content[0].text); }
function mockFetch(responder: (url: string, init: RequestInit) => Response | Promise<Response>) { const original = globalThis.fetch; const requests: Array<{url:string;init:RequestInit}> = []; globalThis.fetch = (async (input, init = {}) => { const row = { url: String(input), init }; requests.push(row); return responder(row.url, row.init); }) as typeof fetch; return { requests, restore: () => { globalThis.fetch = original; } }; }
const rawUrl = "https://user:pass@receiver.example.com/path?token=abc&mode=full#fragment";
const fingerprint = createHash("sha256").update(rawUrl).digest("hex");
const hook = { id: 3, payload_url: rawUrl, content_type: 1, last_delivery_status: 2, secret: "super-secret", wildcard_web_hook: false, verify_certificate: true, active: false, categories: [{ id: 4 }], tags: [{ id: 5 }], groups: [{ id: 6 }], web_hook_event_types: [{ id: 7, name: "topic_created" }] };
const extras = { grouped_event_types: { topics: [{ id: 7, name: "topic_created" }] }, content_types: [{ id: 1, name: "application/json" }], delivery_statuses: [{ id: 2, name: "successful" }] };

test("webhook catalog is isolated and accurately gated", () => {
  assert.deepEqual(webhookTools.map((tool) => tool.name), ["discourse_list_webhooks", "discourse_get_webhook", "discourse_create_webhook", "discourse_update_webhook", "discourse_delete_webhook", "discourse_list_webhook_events", "discourse_ping_webhook", "discourse_redeliver_webhook_event"]);
  webhookTools.forEach((tool, index) => { assert.deepEqual(tool.toolsets, ["webhooks"]); assert.equal(tool.availability, [0,1,5].includes(index) ? "always" : "writes_enabled"); assert.equal(tool.annotations?.openWorldHint, true); });
});

test("webhook reads require configured admin-style auth before HTTP", async () => { const mock = mockFetch(() => Response.json({ web_hooks: [] })); try { const result = await harness(false).invoke("discourse_list_webhooks", {}); assert.equal(result.isError, true); assert.equal(mock.requests.length, 0); } finally { mock.restore(); } });

test("webhook list strips secrets, sanitizes URL credentials, and normalizes catalog", async () => {
  const mock = mockFetch(() => Response.json({ web_hooks: [hook], extras, total_rows_web_hooks: 1 }));
  try {
    const result = body(await harness().invoke("discourse_list_webhooks", {})); const row = result.webhooks[0];
    assert.equal(row.secret_configured, true); assert.equal(row.destination_fingerprint, fingerprint); assert.equal(row.payload_url_origin, "https://receiver.example.com"); assert.equal(row.payload_url.includes("user"), false); assert.equal(row.payload_url.includes("abc"), false); assert.match(row.payload_url, /token=%5Bredacted%5D/); assert.equal(JSON.stringify(result).includes("super-secret"), false); assert.equal(result.catalog.event_types[0].name, "topic_created");
  } finally { mock.restore(); }
});

test("webhook detail resolves an explicitly requested live catalog", async () => {
  const mock = mockFetch((url) => url.includes("web_hooks.json") ? Response.json({ web_hooks: [hook], extras }) : Response.json({ web_hook: hook, extras: {} }));
  try { const result = body(await harness().invoke("discourse_get_webhook", { webhook_id: 3, include_catalog: true })); assert.equal(result.webhook.content_type.name, "application/json"); assert.equal(result.catalog.event_types[0].name, "topic_created"); assert.equal(mock.requests.length, 2); } finally { mock.restore(); }
});

test("webhook event diagnostics omit raw content and redact bounded confirmed previews", async () => {
  const event = { id: 9, web_hook_id: 3, request_url: rawUrl, headers: JSON.stringify({ Authorization: "Bearer never", "Content-Type": "application/json", Cookie: "x" }), payload: JSON.stringify({ title: "ok", api_key: "never", nested: { password: "never" }, callback: "https://user:pass@private.example/path", raw: "Authorization: Bearer hidden" }), status: 500, response_headers: { "Set-Cookie": "never" }, response_body: "Authorization: Bearer never\n-----BEGIN PRIVATE KEY-----\nnever\n-----END PRIVATE KEY-----", duration: 12, created_at: "2026-01-01", redelivering: false };
  const mock = mockFetch(() => Response.json({ web_hook_events: [event], total_rows_web_hook_events: 1 }));
  try {
    const invoke = harness().invoke; const safe = body(await invoke("discourse_list_webhook_events", { webhook_id: 3 })); assert.equal(safe.events[0].request_payload_preview, undefined); assert.equal(JSON.stringify(safe).includes("Bearer never"), false);
    const confirmed = body(await invoke("discourse_list_webhook_events", { webhook_id: 3, include_content: true, confirm_sensitive_content: true, content_limit: 100 })); assert.equal(confirmed.events[0].content_included, true); assert.equal(JSON.stringify(confirmed).includes("Bearer never"), false); assert.equal(JSON.stringify(confirmed).includes("Bearer hidden"), false); assert.equal(JSON.stringify(confirmed).includes("user:pass"), false); assert.equal(JSON.stringify(confirmed).includes("\"api_key\":\"never\""), false); assert.ok(confirmed.events[0].request_header_names.includes("authorization"));
    const rejected = await invoke("discourse_list_webhook_events", { webhook_id: 3, include_content: true }); assert.equal(rejected.isError, true); assert.equal(mock.requests.length, 2);
  } finally { mock.restore(); }
});

test("webhook create resolves live catalogs and sends the exact safe nested payload once", async () => {
  const mock = mockFetch((_url, init) => init.method === "POST" ? Response.json({ web_hook: hook }) : Response.json({ web_hooks: [], extras, total_rows_web_hooks: 0 }));
  try {
    const result = body(await harness(true, "https://hook-create.example.com").invoke("discourse_create_webhook", { payload_url: "https://receiver.example.com/hook", content_type: "application/json", secret: "abcdefghijkl", event_type_ids: [7], confirm_external_delivery: true }));
    assert.equal(result.created, true); assert.equal(JSON.stringify(result).includes("abcdefghijkl"), false); assert.equal(mock.requests[1]!.url, "https://hook-create.example.com/admin/api/web_hooks.json"); assert.equal(mock.requests[1]!.init.method, "POST");
    assert.deepEqual(JSON.parse(String(mock.requests[1]!.init.body)), { web_hook: { payload_url: "https://receiver.example.com/hook", content_type: 1, active: false, verify_certificate: true, wildcard_web_hook: false, web_hook_event_type_ids: [7], category_ids: [], tag_ids: [], group_ids: [], secret: "abcdefghijkl" } });
  } finally { mock.restore(); }
});

test("webhook create risk combinations and unknown event IDs fail before mutation", async () => {
  const mock = mockFetch(() => Response.json({ web_hooks: [], extras, total_rows_web_hooks: 0 })); try {
    const invoke = harness(true, "https://hook-reject.example.com").invoke;
    assert.equal((await invoke("discourse_create_webhook", { payload_url: "http://receiver.example.com", content_type: "application/json", event_type_ids: [7], confirm_external_delivery: true })).isError, true);
    assert.equal((await invoke("discourse_create_webhook", { payload_url: "https://receiver.example.com", content_type: "application/json", wildcard_web_hook: true, event_type_ids: [7], confirm_external_delivery: true, confirm_wildcard: true })).isError, true);
    assert.equal((await invoke("discourse_create_webhook", { payload_url: "https://receiver.example.com", content_type: "application/json", event_type_ids: [999], confirm_external_delivery: true })).isError, true);
    assert.equal(mock.requests.some((r) => r.init.method === "POST"), false);
  } finally { mock.restore(); }
});

test("webhook update enforces fresh preconditions and complete replacement confirmation", async () => {
  const mock = mockFetch((url, init) => { if (init.method === "PUT") return Response.json({ web_hook: { ...hook, active: true } }); if (url.includes("web_hooks.json")) return Response.json({ web_hooks: [hook], extras }); return Response.json({ web_hook: hook, extras: {} }); });
  try {
    const invoke = harness(true, "https://hook-update.example.com").invoke;
    const mismatch = await invoke("discourse_update_webhook", { webhook_id: 3, expected_destination_fingerprint: "0".repeat(64), expected_active: false, active: true, confirm_update: true, confirm_activate: true }); assert.equal(mismatch.isError, true); assert.equal(mock.requests.length, 1);
    const replacement = await invoke("discourse_update_webhook", { webhook_id: 3, expected_destination_fingerprint: fingerprint, expected_active: false, event_type_ids: [8], confirm_update: true }); assert.equal(replacement.isError, true);
    const result = body(await invoke("discourse_update_webhook", { webhook_id: 3, expected_destination_fingerprint: fingerprint, expected_active: false, active: true, confirm_update: true, confirm_activate: true })); assert.equal(result.updated, true); assert.equal(mock.requests.filter((r) => r.init.method === "PUT").length, 1);
  } finally { mock.restore(); }
});

test("delete, ping, and redelivery use guarded exact single-action routes", async () => {
  const actions = [
    ["discourse_delete_webhook", { webhook_id: 3, expected_destination_fingerprint: fingerprint, confirm_delete: true }, "DELETE", "/admin/api/web_hooks/3.json"],
    ["discourse_ping_webhook", { webhook_id: 3, expected_destination_fingerprint: fingerprint, confirm_external_request: true }, "POST", "/admin/api/web_hooks/3/ping.json"],
  ] as const;
  for (const [index, [name, input, method, suffix]] of actions.entries()) { const mock = mockFetch((_url, init) => init.method === method ? Response.json({ success: "OK" }) : Response.json({ web_hook: hook, extras: {} })); try { await harness(true, `https://hook-action-${index}.example.com`).invoke(name, input); assert.equal(mock.requests.at(-1)!.init.method, method); assert.ok(mock.requests.at(-1)!.url.endsWith(suffix)); } finally { mock.restore(); } }
  const mock = mockFetch((url, init) => { if (init.method === "POST") return Response.json({ web_hook_event: { id: 9, web_hook_id: 3, status: 200 } }); if (url.includes("events/bulk")) return Response.json([{ id: 9, web_hook_id: 3, status: 500, payload: "private" }]); return Response.json({ web_hook: hook, extras: {} }); });
  try { const result = body(await harness(true, "https://hook-redelivery.example.com").invoke("discourse_redeliver_webhook_event", { webhook_id: 3, event_id: 9, expected_destination_fingerprint: fingerprint, expected_event_status: 500, confirm_redelivery: true })); assert.equal(result.redelivered, true); assert.equal(mock.requests.filter((r) => r.init.method === "POST").length, 1); assert.ok(mock.requests[1]!.url.includes("ids%5B%5D=9")); assert.ok(mock.requests[2]!.url.endsWith("/admin/api/web_hooks/3/events/9/redeliver.json")); assert.equal(JSON.stringify(result).includes("\"payload\":\"private\""), false); } finally { mock.restore(); }
});

test("webhook secret clearing requires confirmation before HTTP", async () => {
  const mock = mockFetch(() => Response.json({ web_hook: hook }));
  try { const result = await harness(true, "https://hook-clear.example.com").invoke("discourse_update_webhook", { webhook_id: 3, expected_destination_fingerprint: fingerprint, expected_active: false, secret: "", confirm_update: true }); assert.equal(result.isError, true); assert.equal(mock.requests.length, 0); } finally { mock.restore(); }
});

test("webhook HTTP 5xx mutations are not retried and ownership 404 is structured", async () => {
  const failed = mockFetch((_url, init) => init.method === "POST" ? Response.json({ errors: ["failed"] }, { status: 500 }) : Response.json({ web_hooks: [], extras }));
  try { const result = body(await harness(true, "https://hook-500.example.com").invoke("discourse_create_webhook", { payload_url: "https://receiver.example.com", content_type: "application/json", event_type_ids: [7], confirm_external_delivery: true })); assert.equal(result.status, 500); assert.equal(failed.requests.filter((request) => request.init.method === "POST").length, 1); } finally { failed.restore(); }
  const missing = mockFetch((url) => url.includes("events/bulk") ? Response.json({ errors: ["not found"] }, { status: 404 }) : Response.json({ web_hook: hook, extras: {} }));
  try { const result = body(await harness(true, "https://hook-owner.example.com").invoke("discourse_redeliver_webhook_event", { webhook_id: 3, event_id: 9, expected_destination_fingerprint: fingerprint, expected_event_status: -1, confirm_redelivery: true })); assert.equal(result.code, "event_not_owned"); assert.equal(missing.requests.some((request) => request.init.method === "POST"), false); } finally { missing.restore(); }
});

test("webhook post-attempt transport failure is outcome_unknown and is never retried", async () => {
  const mock = mockFetch((_url, init) => { if (init.method === "POST") throw new Error("socket closed secret=never"); return Response.json({ web_hooks: [], extras, total_rows_web_hooks: 0 }); });
  try { const result = body(await harness(true, "https://hook-unknown.example.com").invoke("discourse_create_webhook", { payload_url: "https://receiver.example.com", content_type: "application/json", event_type_ids: [7], confirm_external_delivery: true })); assert.equal(result.code, "outcome_unknown"); assert.equal(result.outcome_unknown, true); assert.equal(mock.requests.filter((r) => r.init.method === "POST").length, 1); assert.equal(JSON.stringify(result).includes("never"), false); } finally { mock.restore(); }
});
