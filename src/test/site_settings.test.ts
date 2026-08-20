import test from "node:test";
import assert from "node:assert/strict";
import { Logger } from "../util/logger.js";
import { SiteState } from "../site/state.js";
import type { ToolContext, ToolRegistrationOptions } from "../tools/types.js";
import { listSiteSettingsTool } from "../tools/builtin/administration/list_site_settings.js";
import { updateSiteSettingTool } from "../tools/builtin/site_settings/update_site_setting.js";
import { validateSettingValue } from "../tools/builtin/common/site_setting_values.js";

const logger = new Logger("silent");
function harness(auth = true, site = "https://settings.example.com") {
  const siteState = new SiteState({ logger, timeoutMs: 5_000, defaultAuth: auth ? { type: "api_key", key: "key", username: "system" } : { type: "none" } }); siteState.selectSite(site);
  const ctx = { server: {} as any, siteState, logger, maxReadLength: 50_000, allowedUploadPaths: [] } satisfies ToolContext;
  const opts = { allowWrites: true, toolsMode: "discourse_api_only", toolsets: ["site_settings"] } satisfies ToolRegistrationOptions;
  const invoke = (name: string, input: Record<string, unknown>) => (name === listSiteSettingsTool.name ? listSiteSettingsTool : updateSiteSettingTool).handler(input as never, {} as never, ctx, opts);
  return { invoke };
}
function body(result: any) { return JSON.parse(result.content[0].text); }
function mockFetch(responder: (url: string, init: RequestInit) => Response | Promise<Response>) { const original = globalThis.fetch; const requests: Array<{url:string;init:RequestInit}> = []; globalThis.fetch = (async (input, init = {}) => { const row = { url: String(input), init }; requests.push(row); return responder(row.url, row.init); }) as typeof fetch; return { requests, restore: () => { globalThis.fetch = original; } }; }

const ordinary = { setting: "title", humanized_name: "Title", description: "Forum title", category: "required", type: "string", value: "Old", default: "Discourse", secret: false, requires_confirmation: false };
test("site-setting list preserves filters and masks secret and credential-like values", async () => {
  const mock = mockFetch(() => Response.json({ site_settings: [{ setting: "default_locale", value: "en", default: "en", type: "enum" }, ordinary, { setting: "smtp_password", type: "string", value: "never", default: "also-never", secret: false }, { setting: "api_token", value: "x", default: "y", secret: true }] }));
  try {
    const result = body(await harness().invoke("discourse_list_site_settings", { names: ["title"], categories: ["required"], plugin: "core" }));
    assert.match(mock.requests[0]!.url, /names%5B%5D=title/); assert.match(mock.requests[0]!.url, /categories%5B%5D=required/); assert.match(mock.requests[0]!.url, /plugin=core/);
    assert.equal(result.site_settings[0].value, "Old"); assert.equal(result.site_settings[0].editable_by_this_tool, true);
    for (const row of result.site_settings.slice(1)) { assert.equal(row.value, null); assert.equal(row.default, null); assert.equal(row.secret, true); assert.equal(row.editable_by_this_tool, false); }
    assert.equal(JSON.stringify(result).includes("never"), false);
  } finally { mock.restore(); }
});

test("site-setting list treats generated empty arrays and blank plugin as no filters", async () => {
  const mock = mockFetch(() => Response.json({ site_settings: [ordinary, { ...ordinary, setting: "site_description" }] }));
  try {
    const result = body(await harness().invoke("discourse_list_site_settings", { categories: [], names: [], plugin: "", overridden_only: false, offset: 0, limit: 500 }));
    assert.equal(mock.requests[0]!.url, "https://settings.example.com/admin/site_settings.json");
    assert.deepEqual(result.site_settings.map((row: any) => row.setting), ["title", "site_description"]);
    assert.equal(result.meta.total, 2);
  } finally { mock.restore(); }
});

test("site-setting list can return only currently overridden settings", async () => {
  const mock = mockFetch(() => Response.json({ site_settings: [
    { ...ordinary, setting: "unchanged", value: "same", default: "same" },
    ordinary,
    { setting: "smtp_password", type: "string", value: "configured", default: "", secret: true },
  ] }));
  try {
    const result = body(await harness().invoke("discourse_list_site_settings", { overridden_only: true }));
    assert.deepEqual(result.site_settings.map((row: any) => row.setting), ["title", "smtp_password"]);
    assert.equal(result.site_settings[1].value, null);
    assert.deepEqual(result.meta, { offset: 0, limit: 100, returned: 2, total: 2, total_before_local_filter: 3, overridden_only: true, has_more: false, next_offset: null });
  } finally { mock.restore(); }
});

test("site-setting reads reject missing admin-style auth before HTTP", async () => {
  const mock = mockFetch(() => Response.json({ site_settings: [] })); try { const result = await harness(false).invoke("discourse_list_site_settings", {}); assert.equal(result.isError, true); assert.equal(mock.requests.length, 0); } finally { mock.restore(); }
});

test("site-setting update preflights, sends exact keyed no-retry PUT, and verifies", async () => {
  let reads = 0; const mock = mockFetch((_url, init) => init.method === "PUT" ? new Response(null, { status: 204 }) : Response.json({ site_settings: [{ ...ordinary, value: reads++ === 0 ? "Old" : "New" }] }));
  try {
    const result = body(await harness(true, "https://setting-update.example.com").invoke("discourse_update_site_setting", { setting: "title", operation: "set", value: "New", expected_current_value: "Old", confirm_change: true }));
    assert.equal(result.updated, true); assert.equal(result.verified, true); assert.equal(mock.requests.length, 3);
    assert.equal(mock.requests[1]!.init.method, "PUT"); assert.equal(mock.requests[1]!.url, "https://setting-update.example.com/admin/site_settings/title.json"); assert.deepEqual(JSON.parse(String(mock.requests[1]!.init.body)), { title: "New" });
  } finally { mock.restore(); }
});

test("site-setting mutation rejects conflicts, blocked types, confirmations, and no-ops before PUT", async () => {
  const fixtures = [{ ...ordinary, value: "Changed" }, { ...ordinary, setting: "logo", type: "upload", value: 1 }, { ...ordinary, requires_confirmation: "simple" }, ordinary]; let index = 0;
  const mock = mockFetch(() => Response.json({ site_settings: [fixtures[index++]!] }));
  try {
    const invoke = harness(true, "https://setting-reject.example.com").invoke;
    for (const input of [
      { setting: "title", operation: "set", value: "New", expected_current_value: "Old", confirm_change: true },
      { setting: "logo", operation: "set", value: 2, expected_current_value: 1, confirm_change: true },
      { setting: "title", operation: "set", value: "New", expected_current_value: "Old", confirm_change: true },
      { setting: "title", operation: "set", value: "Old", expected_current_value: "Old", confirm_change: true },
    ]) assert.equal((await invoke("discourse_update_site_setting", input)).isError, true);
    assert.equal(mock.requests.some((request) => request.init.method === "PUT"), false);
  } finally { mock.restore(); }
});

test("shared site-setting validation handles booleans, numbers, bounds, enums, lists, and empty strings", () => {
  assert.equal(validateSettingValue({ setting: "flag", type: "bool" }, true), null);
  assert.match(validateSettingValue({ setting: "flag", type: "bool" }, "yes") ?? "", /boolean/);
  assert.equal(validateSettingValue({ setting: "count", type: "int", min: 1, max: 3 }, 2), null);
  assert.match(validateSettingValue({ setting: "count", type: "int", min: 1 }, 0) ?? "", /at least/);
  assert.equal(validateSettingValue({ setting: "ratio", type: "float" }, "1.5"), null);
  assert.equal(validateSettingValue({ setting: "choice", valid_values: ["a", "b"] }, "a"), null);
  assert.match(validateSettingValue({ setting: "choice", valid_values: ["a"] }, "b") ?? "", /unsupported/);
  assert.equal(validateSettingValue({ setting: "items", type: "list" }, ["a", 2]), null);
  assert.equal(validateSettingValue({ setting: "title", type: "string" }, ""), null);
});

test("site-setting mutation blocks sensitive, structured, and unavailable settings before PUT", async () => {
  const fixtures = [
    { setting: "api_key", type: "string", value: "x", default: "", secret: false },
    { setting: "structured", type: "objects", value: "[]", default: "[]" },
    { setting: "images", type: "uploaded_image_list", value: "", default: "" },
    null,
  ]; let index = 0;
  const mock = mockFetch(() => Response.json({ site_settings: fixtures[index] ? [fixtures[index++]!] : (index++, []) }));
  try { const invoke = harness(true, "https://setting-blocks.example.com").invoke; for (const [setting, current, value] of [["api_key", "x", "y"], ["structured", "[]", [1]], ["images", "", "url"], ["missing", "", "x"]] as const) { const result = await invoke("discourse_update_site_setting", { setting, operation: "set", value, expected_current_value: current, confirm_change: true }); assert.equal(result.isError, true); } assert.equal(mock.requests.some((request) => request.init.method === "PUT"), false); } finally { mock.restore(); }
});

test("site-setting update fails closed on locally evaluable dependencies", async () => {
  const dependent = { ...ordinary, depends_on: ["feature_enabled"], depends_behavior: "hidden", depends_on_values: { feature_enabled: ["true"] } };
  const mock = mockFetch((url) => Response.json({ site_settings: url.includes("feature_enabled") ? [dependent, { setting: "feature_enabled", type: "bool", value: "false", default: "false" }] : [dependent] }));
  try { const result = body(await harness(true, "https://setting-dependency.example.com").invoke("discourse_update_site_setting", { setting: "title", operation: "set", value: "New", expected_current_value: "Old", confirm_change: true })); assert.equal(result.code, "precondition_failed"); assert.deepEqual(result.unsatisfied_dependencies, ["feature_enabled"]); assert.equal(mock.requests.some((request) => request.init.method === "PUT"), false); } finally { mock.restore(); }
});

test("site-setting verification mismatch and failed verification read never claim success", async () => {
  let call = 0; const mismatch = mockFetch((_url, init) => init.method === "PUT" ? new Response(null, { status: 204 }) : Response.json({ site_settings: [{ ...ordinary, value: call++ === 0 ? "Old" : "Different" }] }));
  try { const result = body(await harness(true, "https://setting-mismatch.example.com").invoke("discourse_update_site_setting", { setting: "title", operation: "set", value: "New", expected_current_value: "Old", confirm_change: true })); assert.equal(result.code, "verification_failed"); assert.equal(result.updated, false); } finally { mismatch.restore(); }
  let reads = 0; const failedRead = mockFetch((_url, init) => { if (init.method === "PUT") return new Response(null, { status: 204 }); if (reads++ === 0) return Response.json({ site_settings: [ordinary] }); throw new Error("verification socket closed"); });
  try { const result = body(await harness(true, "https://setting-read-fail.example.com").invoke("discourse_update_site_setting", { setting: "title", operation: "set", value: "New", expected_current_value: "Old", confirm_change: true })); assert.equal(result.code, "outcome_unknown"); assert.equal(result.outcome_unknown, true); } finally { failedRead.restore(); }
});

test("site-setting reset uses fresh default and post-attempt transport failures are outcome_unknown", async () => {
  const mock = mockFetch((_url, init) => { if (init.method === "PUT") throw new Error("socket closed with secret value"); return Response.json({ site_settings: [{ ...ordinary, value: "Custom", default: "Discourse" }] }); });
  try {
    const result = body(await harness(true, "https://setting-unknown.example.com").invoke("discourse_update_site_setting", { setting: "title", operation: "reset_to_default", expected_current_value: "Custom", confirm_change: true }));
    assert.equal(result.code, "outcome_unknown"); assert.equal(result.outcome_unknown, true); assert.equal(JSON.stringify(result).includes("secret value"), false);
    assert.deepEqual(JSON.parse(String(mock.requests[1]!.init.body)), { title: "Discourse" });
  } finally { mock.restore(); }
});
