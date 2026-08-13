import test from 'node:test';
import assert from 'node:assert/strict';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Logger } from '../util/logger.js';
import { registerAllTools, type ToolRegistrationOptions } from '../tools/registry.js';
import { registerAllResources, type ResourceRegistrar } from '../resources/registry.js';
import { registerAllPrompts, type PromptRegistrar } from '../prompts/registry.js';
import { SiteState } from '../site/state.js';
import type { ToolRegistrar } from '../tools/types.js';

interface ToolResult {
  isError?: boolean;
  content?: Array<{ type: string; text: string }>;
}

type ToolHandler = (args: Record<string, unknown>, extra: unknown) => Promise<ToolResult>;

/** A captured registration, including the explicit registration order. */
interface ToolRegistration {
  name: string;
  metadata: Record<string, unknown>;
  handler: ToolHandler;
}

/** Creates a minimal mock server that captures tool registrations for testing */
function createMockServer(): {
  server: ToolRegistrar;
  tools: Record<string, { handler: ToolHandler }>;
  calls: ToolRegistration[];
} {
  const tools: Record<string, { handler: ToolHandler }> = {};
  const calls: ToolRegistration[] = [];
  // Cast needed because mock doesn't implement the SDK's generic signature.
  const server = {
    registerTool(name: string, metadata: Record<string, unknown>, handler: ToolHandler) {
      calls.push({ name, metadata, handler });
      tools[name] = { handler };
    },
  } as ToolRegistrar;
  return { server, tools, calls };
}

test('registers built-in tools with the real MCP server', async () => {
  const logger = new Logger('silent');
  const siteState = new SiteState({ logger, timeoutMs: 5000, defaultAuth: { type: 'none' } });
  const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: { listChanged: false } } });

  await registerAllTools(server, siteState, logger, { allowWrites: false, toolsMode: 'discourse_api_only' } satisfies ToolRegistrationOptions);

  // If no error is thrown we consider registration successful.
  assert.ok(true);
});

test('registers write-enabled tools when allowWrites=true', async () => {
  const logger = new Logger('silent');
  const siteState = new SiteState({ logger, timeoutMs: 5000, defaultAuth: { type: 'none' } });
  const { server, tools } = createMockServer();

  await registerAllTools(server, siteState, logger, { allowWrites: true, toolsMode: 'discourse_api_only' } satisfies ToolRegistrationOptions);

  assert.ok('discourse_create_post' in tools);
  assert.ok('discourse_create_category' in tools);
  assert.ok('discourse_create_topic' in tools);
  assert.ok('discourse_update_topic' in tools);
  assert.ok('discourse_update_user' in tools);
});

test('does not register write tools when allowWrites=false', async () => {
  const logger = new Logger('silent');
  const siteState = new SiteState({ logger, timeoutMs: 5000, defaultAuth: { type: 'none' } });
  const { server, tools } = createMockServer();

  await registerAllTools(server, siteState, logger, { allowWrites: false, toolsMode: 'discourse_api_only' } satisfies ToolRegistrationOptions);

  assert.ok(!('discourse_create_post' in tools));
  assert.ok(!('discourse_create_topic' in tools));
  assert.ok(!('discourse_update_topic' in tools));
  assert.ok(!('discourse_update_user' in tools));
  assert.ok('discourse_search' in tools);
  assert.ok('discourse_read_topic' in tools);
});

// Simple HTTP integration using fixtures when present
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function readFixture(name: string) {
  const p = path.resolve(__dirname, '../../fixtures/try', name);
  try {
    const data = await readFile(p, 'utf8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

test('fixtures manifest exists or sync script can be run', async () => {
  const manifest = await readFixture('manifest.json');
  assert.ok(manifest === null || typeof manifest === 'object');
});

// Integration-style test: select site then search (HTTP mocked)
test('select-site then search flow works with mocked HTTP', async () => {
  const logger = new Logger('silent');
  const siteState = new SiteState({ logger, timeoutMs: 5000, defaultAuth: { type: 'none' } });

  const { server, tools } = createMockServer();

  await registerAllTools(server, siteState, logger, { allowWrites: false, toolsMode: 'discourse_api_only' });

  // Mock fetch
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.endsWith('/about.json')) {
      return new Response(JSON.stringify({ about: { title: 'Example Discourse' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.includes('/search.json')) {
      return new Response(JSON.stringify({ topics: [{ id: 123, title: 'Hello World', slug: 'hello-world' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('not found', { status: 404 });
  }) as any;

  try {
    // Select site
    const selectRes = await tools['discourse_select_site'].handler({ site: 'https://example.com' }, {});
    assert.equal(selectRes?.isError, undefined);

    // Search - now returns JSON-only (v0.2.0)
    const searchRes = await tools['discourse_search'].handler({ query: 'hello' }, {});
    const text = String(searchRes?.content?.[0]?.text || '');
    const json = JSON.parse(text);
    assert.ok(json.results);
    assert.equal(json.results[0].slug, 'hello-world');
  } finally {
    globalThis.fetch = originalFetch as any;
  }
});

// Tethered mode: preselect site via --site and hide select_site
test('tethered mode hides select_site and allows search without selection', async () => {
  const logger = new Logger('silent');
  const siteState = new SiteState({ logger, timeoutMs: 5000, defaultAuth: { type: 'none' } });

  const { server, tools } = createMockServer();

  // Mock fetch
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.endsWith('/about.json')) {
      return new Response(JSON.stringify({ about: { title: 'Example Discourse' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.includes('/search.json')) {
      return new Response(JSON.stringify({ topics: [{ id: 123, title: 'Hello World', slug: 'hello-world' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('not found', { status: 404 });
  }) as any;

  try {
    // Emulate --site tethering: validate via /about.json and preselect site
    const { base, client } = siteState.buildClientForSite('https://example.com');
    await client.get('/about.json');
    siteState.selectSite(base);

    // Register tools with select_site hidden
    await registerAllTools(server, siteState, logger, { allowWrites: false, toolsMode: 'discourse_api_only', hideSelectSite: true } satisfies ToolRegistrationOptions);

    // Ensure select tool is not exposed
    assert.ok(!('discourse_select_site' in tools));

    // Search should work without calling select first - now returns JSON-only (v0.2.0)
    const searchRes = await tools['discourse_search'].handler({ query: 'hello' }, {});
    const text = String(searchRes?.content?.[0]?.text || '');
    const json = JSON.parse(text);
    assert.ok(json.results);
    assert.equal(json.results[0].slug, 'hello-world');
  } finally {
    globalThis.fetch = originalFetch as any;
  }
});

test('default-search prefix is applied to queries', async () => {
  const logger = new Logger('silent');
  const siteState = new SiteState({ logger, timeoutMs: 5000, defaultAuth: { type: 'none' } });

  const { server, tools } = createMockServer();

  // Mock fetch to capture the search URL
  let lastUrl: string | undefined;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    lastUrl = url;
    if (url.endsWith('/about.json')) {
      return new Response(JSON.stringify({ about: { title: 'Example Discourse' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.includes('/search.json')) {
      return new Response(JSON.stringify({ topics: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('not found', { status: 404 });
  }) as any;

  try {
    const { base, client } = siteState.buildClientForSite('https://example.com');
    await client.get('/about.json');
    siteState.selectSite(base);

    await registerAllTools(server, siteState, logger, { allowWrites: false, toolsMode: 'discourse_api_only', defaultSearchPrefix: 'tag:ai order:latest' } satisfies ToolRegistrationOptions);

    await tools['discourse_search'].handler({ query: 'hello world' }, {});
    assert.ok(lastUrl && lastUrl.includes('/search.json?'));
    const qs = lastUrl!.split('?')[1] || '';
    const params = new URLSearchParams(qs);
    assert.equal(params.get('expanded'), 'true');
    assert.equal(params.get('q'), 'tag:ai order:latest hello world');
  } finally {
    globalThis.fetch = originalFetch as any;
  }
});

// ========================
// Tool registration tests - verify tools are exposed based on auth context
// ========================

// Exact legacy registration order. Keep this independent of builtinTools so it
// characterizes the externally visible contract rather than mirroring it.
const ALL_TOOLS_IN_ORDER = [
  'discourse_select_site',
  'discourse_search',
  'discourse_filter_topics',
  'discourse_read_topic',
  'discourse_read_post',
  'discourse_get_user',
  'discourse_list_user_posts',
  'discourse_list_users',
  'discourse_get_chat_messages',
  'discourse_get_draft',
  'discourse_create_post',
  'discourse_create_user',
  'discourse_create_category',
  'discourse_create_topic',
  'discourse_update_topic',
  'discourse_update_post',
  'discourse_update_user',
  'discourse_upload_file',
  'discourse_save_draft',
  'discourse_delete_draft',
  'discourse_get_query',
  'discourse_run_query',
  'discourse_create_query',
  'discourse_update_query',
  'discourse_delete_query',
] as const;

const WRITE_TOOL_NAMES = new Set([
  'discourse_create_post',
  'discourse_create_user',
  'discourse_create_category',
  'discourse_create_topic',
  'discourse_update_topic',
  'discourse_update_post',
  'discourse_update_user',
  'discourse_upload_file',
  'discourse_save_draft',
  'discourse_delete_draft',
  'discourse_create_query',
  'discourse_update_query',
  'discourse_delete_query',
]);

const READ_ONLY_TOOLS_IN_ORDER = ALL_TOOLS_IN_ORDER.filter(
  (name) => !WRITE_TOOL_NAMES.has(name)
);

test('read-only mode registers read + admin-read tools (access checked at call time)', async () => {
  const logger = new Logger('silent');
  const siteState = new SiteState({ logger, timeoutMs: 5000, defaultAuth: { type: 'none' } });
  const { server, calls } = createMockServer();

  await registerAllTools(server, siteState, logger, {
    allowWrites: false,
    toolsMode: 'discourse_api_only'
  });

  assert.deepEqual(calls.map((call) => call.name), READ_ONLY_TOOLS_IN_ORDER);
});

test('write mode registers all tools', async () => {
  const logger = new Logger('silent');
  const siteState = new SiteState({ logger, timeoutMs: 5000, defaultAuth: { type: 'none' } });
  const { server, calls } = createMockServer();

  await registerAllTools(server, siteState, logger, {
    allowWrites: true,
    toolsMode: 'discourse_api_only'
  });

  assert.deepEqual(calls.map((call) => call.name), ALL_TOOLS_IN_ORDER);
});

test('tethered mode hides select_site from tool list', async () => {
  const logger = new Logger('silent');
  const siteState = new SiteState({ logger, timeoutMs: 5000, defaultAuth: { type: 'none' } });
  const { server, calls } = createMockServer();

  await registerAllTools(server, siteState, logger, {
    allowWrites: false,
    toolsMode: 'discourse_api_only',
    hideSelectSite: true
  });

  assert.deepEqual(
    calls.map((call) => call.name),
    READ_ONLY_TOOLS_IN_ORDER.filter((name) => name !== 'discourse_select_site')
  );
});

test('data_explorer toolset registers only its domain plus untethered site selection', async () => {
  const logger = new Logger('silent');
  const siteState = new SiteState({ logger, timeoutMs: 5000, defaultAuth: { type: 'none' } });
  const { server, calls } = createMockServer();

  await registerAllTools(server, siteState, logger, {
    allowWrites: false,
    toolsMode: 'discourse_api_only',
    toolsets: ['data_explorer']
  });

  assert.deepEqual(calls.map((call) => call.name), [
    'discourse_select_site',
    'discourse_get_query',
    'discourse_run_query'
  ]);
});

test('data_explorer toolset composes with write and tethered registration gates', async () => {
  const logger = new Logger('silent');
  const siteState = new SiteState({ logger, timeoutMs: 5000, defaultAuth: { type: 'none' } });
  const { server, calls } = createMockServer();

  await registerAllTools(server, siteState, logger, {
    allowWrites: true,
    toolsMode: 'discourse_api_only',
    toolsets: ['data_explorer'],
    hideSelectSite: true
  });

  assert.deepEqual(calls.map((call) => call.name), [
    'discourse_get_query',
    'discourse_run_query',
    'discourse_create_query',
    'discourse_update_query',
    'discourse_delete_query'
  ]);
});

test('workflows is opt-in and composes with write and tether gates', async () => {
  const logger = new Logger('silent');
  const siteState = new SiteState({ logger, timeoutMs: 5000, defaultAuth: { type: 'none' } });
  const readOnly = createMockServer();
  await registerAllTools(readOnly.server, siteState, logger, { allowWrites: false, toolsMode: 'discourse_api_only', toolsets: ['workflows'] });
  assert.deepEqual(readOnly.calls.map((call) => call.name), [
    'discourse_select_site', 'discourse_list_workflows', 'discourse_get_workflow',
    'discourse_list_workflow_node_types', 'discourse_resolve_workflow_entity',
    'discourse_list_workflow_templates', 'discourse_list_workflow_executions',
    'discourse_get_workflow_execution', 'discourse_list_workflow_versions',
    'discourse_list_workflow_credentials', 'discourse_evaluate_workflow_expression'
  ]);

  const writes = createMockServer();
  await registerAllTools(writes.server, siteState, logger, { allowWrites: true, toolsMode: 'discourse_api_only', toolsets: ['workflows'], hideSelectSite: true });
  assert.equal(writes.calls.length, 18);
  assert.ok(writes.calls.some((call) => call.name === 'discourse_create_workflow'));
  assert.ok(writes.calls.some((call) => call.name === 'discourse_update_workflow_pin_data'));
  assert.equal(writes.calls.some((call) => call.name.includes('preview')), false);
});

test('expanded all selection includes opt-in workflow tools', async () => {
  const logger = new Logger('silent');
  const siteState = new SiteState({ logger, timeoutMs: 5000, defaultAuth: { type: 'none' } });
  const { server, calls } = createMockServer();
  await registerAllTools(server, siteState, logger, { allowWrites: true, toolsMode: 'discourse_api_only', toolsets: ['site', 'search', 'topics', 'users', 'chat', 'drafts', 'uploads', 'data_explorer', 'workflows'] });
  assert.deepEqual(calls.slice(0, ALL_TOOLS_IN_ORDER.length).map((call) => call.name), [...ALL_TOOLS_IN_ORDER]);
  assert.equal(calls.filter((call) => call.name.includes('workflow')).length, 18);
});

test('toolset selection reports empty domains and independent remote discovery', async () => {
  const logger = new Logger('silent');
  const messages: string[] = [];
  logger.info = (message: string) => { messages.push(message); };
  const siteState = new SiteState({ logger, timeoutMs: 5000, defaultAuth: { type: 'none' } });
  const { server } = createMockServer();

  await registerAllTools(server, siteState, logger, {
    allowWrites: false,
    toolsMode: 'auto',
    toolsets: ['uploads']
  });

  assert.ok(messages.some((message) => message.includes("Toolset 'uploads' registered no tools")));
  assert.ok(messages.some((message) => message.includes('toolsets do not filter remote tools')));
});


// ========================
// Resource registration tests - verify resources are exposed based on auth context
// ========================

const BASE_RESOURCES = [
  'site_categories',
  'site_tags',
  'site_groups',
  'chat_channels',
  'user_chat_channels',
  'user_drafts',
];

const ADMIN_RESOURCES = [
  'explorer_schema',
  'explorer_schema_tables',
  'explorer_queries',
  'explorer_queries_page',
];

/** Creates a mock server that captures resource registrations */
function createMockResourceServer(): { server: ResourceRegistrar; resources: Record<string, unknown> } {
  const resources: Record<string, unknown> = {};
  const server = {
    resource(name: string, ...rest: unknown[]) {
      resources[name] = rest;
    },
  } as ResourceRegistrar;
  return { server, resources };
}

test('resources always includes Data Explorer resources regardless of auth', async () => {
  const logger = new Logger('silent');
  const siteState = new SiteState({ logger, timeoutMs: 5000, defaultAuth: { type: 'none' } });
  const { server, resources } = createMockResourceServer();

  registerAllResources(server, { siteState, logger });

  const registeredResources = Object.keys(resources).sort();
  const expectedResources = [...BASE_RESOURCES, ...ADMIN_RESOURCES].sort();
  assert.deepEqual(registeredResources, expectedResources);
});

// ========================
// Prompt registration tests - verify prompts are exposed based on auth context
// ========================

/** Creates a mock server that captures prompt registrations */
function createMockPromptServer(): { server: PromptRegistrar; prompts: Record<string, unknown> } {
  const prompts: Record<string, unknown> = {};
  const server = {
    registerPrompt(name: string, ...rest: unknown[]) {
      prompts[name] = rest;
    },
  } as PromptRegistrar;
  return { server, prompts };
}

test('prompts always includes sql_query prompt regardless of auth', async () => {
  const logger = new Logger('silent');
  const siteState = new SiteState({ logger, timeoutMs: 5000, defaultAuth: { type: 'none' } });
  const { server, prompts } = createMockPromptServer();

  registerAllPrompts(server, { siteState, logger });

  assert.deepEqual(Object.keys(prompts), ['sql_query']);
});
