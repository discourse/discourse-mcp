import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Logger } from "../util/logger.js";
import { SiteState } from "../site/state.js";
import type { ToolContext, ToolRegistrationOptions } from "../tools/types.js";
import { themeTools } from "../tools/builtin/themes/index.js";
import { createThemeSchema, installThemeSchema, updateThemeFieldsSchema } from "../tools/builtin/themes/schemas.js";
import { registerToolDefinitions } from "../tools/definition.js";
import { readAllowedLocalFile } from "../util/safe_local_file.js";

const logger = new Logger("silent");
function harness(auth = true, allowWrites = true, site = "https://themes.example.com") {
  const siteState = new SiteState({ logger, timeoutMs: 5_000, defaultAuth: auth ? { type: "api_key", key: "secret", username: "system" } : { type: "none" } });
  siteState.selectSite(site);
  const ctx = { server: {} as any, siteState, logger, maxReadLength: 50_000, allowedUploadPaths: [] } satisfies ToolContext;
  const opts = { allowWrites, toolsMode: "discourse_api_only", toolsets: ["themes"] } satisfies ToolRegistrationOptions;
  const invoke = async (name: string, input: Record<string, unknown>) => {
    const tool = themeTools.find((candidate) => candidate.name === name);
    assert.ok(tool, `missing ${name}`);
    return tool.handler(input as never, {} as never, ctx, opts);
  };
  return { invoke, ctx, opts };
}
function body(result: any) { return JSON.parse(result.content[0].text); }

function mockFetch(responder: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const original = globalThis.fetch;
  const requests: Array<{ url: string; init: RequestInit }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const request = { url: String(input), init }; requests.push(request);
    return responder(request.url, init);
  }) as typeof fetch;
  return { requests, restore: () => { globalThis.fetch = original; } };
}

const localTheme = {
  id: 4, name: "Local Theme", component: false, system: false, default: false,
  user_selectable: true, auto_update: false, "enabled?": true, "supported?": true,
  remote_theme_id: null, theme_fields: [{ name: "scss", target: "common", type_id: 1, value: "body { color: red }" }],
  settings: [{ setting: "dark", type: "bool", default: false, value: false }], errors: [], child_themes: [], parent_themes: [],
};

test("theme catalog is stable, isolated, and accurately gated", () => {
  assert.deepEqual(themeTools.map((tool) => tool.name), [
    "discourse_list_themes", "discourse_get_theme", "discourse_create_theme", "discourse_install_theme",
    "discourse_update_theme", "discourse_update_theme_fields", "discourse_update_theme_setting",
    "discourse_update_theme_translations", "discourse_sync_remote_theme", "discourse_upload_theme_asset", "discourse_delete_theme",
  ]);
  for (const [index, tool] of themeTools.entries()) {
    assert.deepEqual(tool.toolsets, ["themes"]);
    assert.equal(tool.availability, index < 2 ? "always" : "writes_enabled");
    assert.equal(tool.annotations?.openWorldHint, true);
    assert.equal(tool.annotations?.readOnlyHint, index < 2);
  }
});

test("advertised schemas expose mutually exclusive text/upload/delete and repository/archive variants", async () => {
  assert.equal(createThemeSchema.safeParse({ name: "Text", fields: [{ name: "steampunk", target: "common", type: "scss", value: "body{}" }] }).success, true);
  assert.equal(createThemeSchema.safeParse({ name: "Bad", fields: [{ name: "steampunk", target: "common", type: "scss", value: "body{}", upload_id: 1 }] }).success, false);
  assert.equal(updateThemeFieldsSchema.safeParse({ theme_id: 1, expected_theme_name: "Text", confirm_code_execution: true, confirm_field_replacement: true, fields: [{ name: "asset", target: "common", type: "upload", upload_id: 4 }] }).success, true);
  assert.equal(updateThemeFieldsSchema.safeParse({ theme_id: 1, expected_theme_name: "Text", confirm_code_execution: true, confirm_field_replacement: true, fields: [{ name: "bad", target: "common", type: "scss", upload_id: ":0," }] }).success, false);
  assert.equal(installThemeSchema.safeParse({ source: { kind: "repository", remote_url: "https://github.com/example/theme.git" }, confirm_external_code: true }).success, true);
  assert.equal(installThemeSchema.safeParse({ source: { kind: "repository", remote_url: "https://github.com/example/theme.git", archive_data: { base64: "AA==", filename: "unused.zip" } }, confirm_external_code: true }).success, false);

  const server = new McpServer({ name: "theme-schema-test", version: "1" });
  const client = new Client({ name: "theme-schema-client", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const { ctx, opts } = harness();
  registerToolDefinitions(themeTools, { ...ctx, server }, opts);
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const tools = await client.listTools();
    const create = tools.tools.find((tool) => tool.name === "discourse_create_theme")!.inputSchema as any;
    const update = tools.tools.find((tool) => tool.name === "discourse_update_theme_fields")!.inputSchema as any;
    const install = tools.tools.find((tool) => tool.name === "discourse_install_theme")!.inputSchema as any;
    assert.equal(create.properties.fields.items.anyOf.length, 2);
    assert.deepEqual(create.properties.fields.items.anyOf[0].required, ["name", "target", "value"]);
    assert.equal(create.properties.fields.items.anyOf[0].properties.upload_id, undefined);
    assert.deepEqual(create.properties.fields.items.anyOf[1].required, ["name", "target", "upload_id", "type"]);
    assert.equal(update.properties.fields.items.anyOf.length, 3);
    assert.equal(install.properties.source.anyOf.length, 3);
    assert.deepEqual(install.properties.source.anyOf[0].required, ["kind", "remote_url"]);
    assert.equal(install.properties.source.anyOf[0].properties.archive_data, undefined);
  } finally {
    await client.close(); await server.close();
  }
});
test("theme reads require configured admin-style authentication before HTTP", async () => {
  const mock = mockFetch(() => Response.json({ themes: [] }));
  try {
    const result = await harness(false).invoke("discourse_list_themes", {});
    assert.equal(result.isError, true);
    assert.equal(mock.requests.length, 0);
  } finally { mock.restore(); }
});

test("theme list uses one exact route, slim redacted projections, and local pagination", async () => {
  const mock = mockFetch(() => Response.json({ themes: [
    localTheme,
    { id: 5, name: "Remote Component", component: true, system: false, remote_theme_id: 9, theme_fields: [{ value: "must not leak", error: "compile" }], remote_theme: { id: 9, remote_url: "https://user:pass@example.com/theme.git", branch: "main", "is_git?": true, commits_behind: 2, private_key: "never" } },
    { id: -1, name: "System", component: false, system: true },
  ] }));
  try {
    const result = body(await harness().invoke("discourse_list_themes", { kind: "component", include_system: false, limit: 1, offset: 0 }));
    assert.equal(mock.requests[0]?.url, "https://themes.example.com/admin/themes.json");
    assert.equal(result.themes.length, 1);
    assert.equal(result.themes[0].remote.url.includes("pass"), false);
    assert.equal(JSON.stringify(result).includes("must not leak"), false);
    assert.equal(JSON.stringify(result).includes("private_key"), false);
    assert.deepEqual(result.meta, { total_visible: 1, offset: 0, limit: 1, returned: 1, has_more: false, pagination: "local" });
  } finally { mock.restore(); }
});

test("theme detail separates field visibility from local/Git/ZIP editability", async () => {
  const fixtures = [
    { theme: localTheme },
    { theme: { ...localTheme, id: 5, remote_theme_id: 9, remote_theme: { id: 9, remote_url: "https://example.com/repo.git", "is_git?": true }, theme_fields: [{ name: "scss", target: "common", type_id: 1 }] } },
    { theme: { ...localTheme, id: 6, remote_theme_id: 10, remote_theme: { id: 10, remote_url: "", "is_git?": false }, theme_fields: [{ name: "scss", target: "common", type_id: 1 }] } },
  ];
  let index = 0;
  const mock = mockFetch(() => Response.json(fixtures[index++]));
  try {
    const invoke = harness().invoke;
    const local = body(await invoke("discourse_get_theme", { theme_id: 4, include_field_values: true }));
    const git = body(await invoke("discourse_get_theme", { theme_id: 5, include_field_values: true }));
    const zip = body(await invoke("discourse_get_theme", { theme_id: 6, include_field_values: true }));
    assert.equal(local.field_values_available, true); assert.equal(local.fields_directly_editable, true); assert.match(local.fields[0].value, /color/);
    assert.equal(git.field_values_available, false); assert.equal(git.fields_directly_editable, false); assert.equal(git.fields[0].value, undefined);
    assert.equal(zip.field_values_available, false); assert.equal(zip.fields_directly_editable, true);
  } finally { mock.restore(); }
});

test("write access and confirmations reject locally before mutation", async () => {
  const mock = mockFetch(() => Response.json({ theme: localTheme }));
  try {
    const disabled = await harness(true, false).invoke("discourse_create_theme", { name: "No" });
    assert.equal(disabled.isError, true);
    const component = await harness().invoke("discourse_create_theme", { name: "Bad", component: true, set_default: true, confirm_set_default: true });
    assert.equal(component.isError, true);
    const fields = await harness().invoke("discourse_create_theme", { name: "Bad", fields: [{ name: "scss", target: "common", value: "body{}" }] });
    assert.equal(fields.isError, true);
    assert.equal(mock.requests.length, 0);
  } finally { mock.restore(); }
});

test("local theme creation sends only the pinned theme wrapper and numeric field type", async () => {
  const mock = mockFetch((_url, _init) => Response.json({ theme: { ...localTheme, default: true } }, { status: 201 }));
  try {
    const result = body(await harness(true, true, "https://create-theme.example.com").invoke("discourse_create_theme", {
      name: "Local Theme", fields: [{ name: "custom", target: "extra_js", value: "alert(1)", type: "javascript" }],
      set_default: true, confirm_code_execution: true, confirm_set_default: true,
    }));
    assert.equal(result.created, true); assert.equal(result.default_applied, true); assert.equal(result.code_safety_validated, false);
    const request = mock.requests[0]!;
    assert.equal(request.url, "https://create-theme.example.com/admin/themes.json"); assert.equal(request.init.method, "POST");
    const sent = JSON.parse(String(request.init.body));
    assert.deepEqual(sent, { theme: { name: "Local Theme", component: false, default: true, theme_fields: [{ name: "custom", target: "extra_js", value: "alert(1)", type_id: 6 }] } });
    assert.equal(JSON.stringify(sent).includes('"type"'), false);
  } finally { mock.restore(); }
});

test("theme setting false is encoded as a string without becoming revert", async () => {
  let index = 0;
  const mock = mockFetch((_url, _init) => index++ === 0 ? Response.json({ theme: localTheme }) : Response.json({ dark: false }));
  try {
    const result = body(await harness(true, true, "https://setting-theme.example.com").invoke("discourse_update_theme_setting", {
      theme_id: 4, name: "dark", operation: "set", value: false, expected_current_value: false,
    }));
    assert.equal(result.value, false); assert.equal(result.applied, true);
    assert.deepEqual(JSON.parse(String(mock.requests[1]!.init.body)), { name: "dark", value: "false" });
  } finally { mock.restore(); }
});
test("archive installation uses pinned multipart names and inverted migration mapping", async () => {
  const mock = mockFetch((_url, _init) => Response.json({ theme: { ...localTheme, id: 8, remote_theme_id: 3, remote_theme: { id: 3, remote_url: "", "is_git?": false } } }, { status: 201 }));
  try {
    const result = body(await harness(true, true, "https://archive-theme.example.com").invoke("discourse_install_theme", {
      source: { kind: "archive", archive_data: { base64: Buffer.from("zip").toString("base64"), filename: "theme.zip" }, replace_theme_id: 8, component_update_mode: "sync", run_migrations: false },
      confirm_external_code: true, confirm_replace: true,
    }));
    assert.equal(result.created_or_replaced, true); assert.equal(result.source, "archive");
    const form = mock.requests[0]!.init.body as FormData;
    assert.equal(form.get("theme_id"), "8"); assert.equal(form.get("components"), "sync"); assert.equal(form.get("skip_migrations"), "true");
    assert.ok(form.get("theme") instanceof Blob);
  } finally { mock.restore(); }
});

test("repository installation needs no archive placeholders and maps the nested source", async () => {
  const mock = mockFetch((_url, _init) => Response.json({ theme: { ...localTheme, id: 9, remote_theme_id: 4, remote_theme: { id: 4, remote_url: "https://github.com/example/theme.git", "is_git?": true } } }, { status: 201 }));
  try {
    const result = body(await harness(true, true, "https://repository-theme.example.com").invoke("discourse_install_theme", {
      source: { kind: "repository", remote_url: "https://github.com/example/theme.git", branch: "main" },
      confirm_external_code: true,
    }));
    assert.equal(result.source, "repository");
    assert.deepEqual(JSON.parse(String(mock.requests[0]!.init.body)), { remote: "https://github.com/example/theme.git", branch: "main" });
  } finally { mock.restore(); }
});

test("theme asset upload requires authoritative HTTP 201", async () => {
  const mock = mockFetch(() => Response.json({ upload_id: 9 }, { status: 200 }));
  try {
    const result = await harness(true, true, "https://asset-theme.example.com").invoke("discourse_upload_theme_asset", {
      file_data: Buffer.from("asset").toString("base64"), filename: "font.woff2", confirm_asset_upload: true,
    });
    assert.equal(result.isError, true);
    assert.equal(mock.requests.length, 1);
  } finally { mock.restore(); }
});
test("safe local files reject missing roots, traversal, symlink escape, directories, and oversize input", async () => {
  const root = await mkdtemp(join(tmpdir(), "discourse-theme-root-"));
  const outside = await mkdtemp(join(tmpdir(), "discourse-theme-outside-"));
  try {
    const allowed = join(root, "allowed"); await mkdir(allowed);
    const good = join(allowed, "theme.zip"); await writeFile(good, "zip");
    const secret = join(outside, "secret.zip"); await writeFile(secret, "secret");
    const escape = join(allowed, "escape.zip"); await symlink(secret, escape);
    assert.equal((await readAllowedLocalFile(good, [allowed], 10)).data.toString(), "zip");
    await assert.rejects(readAllowedLocalFile(good, [], 10), /disabled/);
    await assert.rejects(readAllowedLocalFile(secret, [allowed], 10), /outside/);
    await assert.rejects(readAllowedLocalFile(escape, [allowed], 10), /outside/);
    await assert.rejects(readAllowedLocalFile(allowed, [allowed], 10), /regular file/);
    await assert.rejects(readAllowedLocalFile(good, [allowed], 2), /maximum size/);
  } finally {
    await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true });
  }
});
test("Git field edits and default deletion are rejected after fresh reads", async () => {
  let calls = 0;
  const mock = mockFetch(() => {
    calls++;
    if (calls === 1) return Response.json({ theme: { ...localTheme, remote_theme_id: 2, remote_theme: { id: 2, remote_url: "https://example.com/r.git", "is_git?": true } } });
    return Response.json({ theme: { ...localTheme, default: true } });
  });
  try {
    const first = await harness(true, true, "https://preconditions.example.com").invoke("discourse_update_theme_fields", {
      theme_id: 4, expected_theme_name: "Local Theme", confirm_code_execution: true, confirm_field_replacement: true,
      fields: [{ name: "scss", target: "common", value: "body{}" }],
    });
    assert.equal(first.isError, true);
    const second = await harness(true, true, "https://preconditions.example.com").invoke("discourse_delete_theme", { theme_id: 4, expected_theme_name: "Local Theme", confirm_delete: true });
    assert.equal(second.isError, true);
    assert.equal(mock.requests.every((request) => request.init.method === "GET"), true);
  } finally { mock.restore(); }
});
