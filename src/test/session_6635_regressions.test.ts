import test from "node:test";
import assert from "node:assert/strict";
import { Logger } from "../util/logger.js";
import { SiteState } from "../site/state.js";
import { builtinTools } from "../tools/builtin/catalog.js";
import type { AuthMode } from "../http/client.js";
import type { ToolContext, ToolRegistrationOptions } from "../tools/types.js";

function setup(auth: AuthMode, allowWrites = true) {
  const logger = new Logger("silent");
  const siteState = new SiteState({ logger, timeoutMs: 5_000, defaultAuth: auth });
  siteState.selectSite("https://example.com");
  const ctx = { server: {} as any, siteState, logger, maxReadLength: 1_000 } satisfies ToolContext;
  const opts = { allowWrites, toolsMode: "discourse_api_only" } satisfies ToolRegistrationOptions;
  return { ctx, opts };
}

function body(result: any) { return JSON.parse(result.content[0].text); }
async function invoke(name: string, input: Record<string, unknown>, ctx: ToolContext, opts: ToolRegistrationOptions) {
  const tool = builtinTools.find((candidate) => candidate.name === name);
  assert.ok(tool, `missing ${name}`);
  return tool.handler(input as any, {} as any, ctx, opts);
}

function mockFetch(responder: (request: Request, index: number) => Response) {
  const original = globalThis.fetch;
  const requests: Request[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    requests.push(request);
    return responder(request, requests.length - 1);
  }) as any;
  return { requests, restore: () => { globalThis.fetch = original; } };
}

test("acting-user writes reject User API Keys before HTTP", async () => {
  const { ctx, opts } = setup({ type: "user_api_key", key: "user-key" });
  const mock = mockFetch(() => Response.json({}));
  try {
    const result = await invoke("discourse_create_post", { topic_id: 1, raw: "body", author_username: "alice" }, ctx, opts);
    assert.equal(result.isError, true);
    assert.match(body(result).error, /global Discourse API key/);
    assert.equal(mock.requests.length, 0);
  } finally { mock.restore(); }
});

test("created posts report actual and requested attribution", async () => {
  const { ctx, opts } = setup({ type: "api_key", key: "global", username: "admin" });
  const mock = mockFetch((request) => {
    assert.equal(request.headers.get("Api-Username"), "alice");
    return Response.json({ id: 4, topic_id: 2, post_number: 3, username: "admin" });
  });
  try {
    const result = body(await invoke("discourse_create_post", { topic_id: 2, raw: "body", author_username: "alice" }, ctx, opts));
    assert.equal(result.username, "admin");
    assert.equal(result.requested_author, "alice");
    assert.equal(result.author_applied, false);
  } finally { mock.restore(); }
});

test("user creation requires a global key and does not invent confirmation", async () => {
  const userKey = setup({ type: "user_api_key", key: "user-key" });
  const rejected = await invoke("discourse_create_user", { username: "sample", email: "sample@example.com", name: "Sample", password: "long-password" }, userKey.ctx, userKey.opts);
  assert.equal(rejected.isError, true);

  const apiKey = setup({ type: "api_key", key: "global", username: "admin" });
  const mock = mockFetch(() => Response.json({ success: true, active: false, message: "Check email" }));
  try {
    const result = body(await invoke("discourse_create_user", { username: "sample", email: "sample@example.com", name: "Sample", password: "long-password" }, apiKey.ctx, apiKey.opts));
    assert.equal(result.request_accepted, true);
    assert.equal(result.created, null);
    assert.equal(result.user_id, null);
    assert.equal(result.username, null);
    assert.equal(result.requested_username, "sample");
    assert.match(result.warning, /unconfirmed/);
  } finally { mock.restore(); }
});

test("topic creation preserves safe upstream validation details", async () => {
  const { ctx, opts } = setup({ type: "api_key", key: "global", username: "admin" });
  const mock = mockFetch(() => Response.json({ errors: ["Category is not allowed"], error_type: "invalid_access" }, { status: 422 }));
  try {
    const result = await invoke("discourse_create_topic", { title: "Topic", raw: "body", category_id: 1 }, ctx, opts);
    assert.equal(result.isError, true);
    assert.deepEqual(body(result).errors, ["Category is not allowed"]);
    assert.equal(body(result).status, 422);
  } finally { mock.restore(); }
});

test("administration tools expose discovery reads and confirmed activation routes", async () => {
  const { ctx, opts } = setup({ type: "api_key", key: "global", username: "admin" });
  const mock = mockFetch((request) => {
    if (request.url.endsWith("/site.json")) return Response.json({ categories: [{ id: 4, name: "General", slug: "general", topic_count: 2 }] });
    if (request.url.includes("/admin/site_settings.json")) return Response.json({ site_settings: [{ setting: "title", value: "Forum", default: "Discourse", category: "required" }] });
    return new Response(null, { status: 204 });
  });
  try {
    const categories = body(await invoke("discourse_list_categories", {}, ctx, opts));
    assert.equal(categories.categories[0].id, 4);
    const settings = body(await invoke("discourse_list_site_settings", { names: ["title"] }, ctx, opts));
    assert.equal(settings.site_settings[0].setting, "title");
    const activation = body(await invoke("discourse_manage_user_activation", { username: "sample", action: "activate_and_approve", confirm: true }, ctx, opts));
    assert.deepEqual(activation.completed_actions, ["activate", "approve"]);
    assert.match(mock.requests.at(-2)!.url, /\/admin\/users\/sample\/activate\.json$/);
    assert.match(mock.requests.at(-1)!.url, /\/admin\/users\/sample\/approve\.json$/);
  } finally { mock.restore(); }
});
