import test from 'node:test';
import assert from 'node:assert/strict';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Logger } from '../util/logger.js';
import { registerAllTools, type RegistryOptions } from '../tools/registry.js';
import { registerAllResources, type ResourceRegistrar } from '../resources/registry.js';
import { registerAllPrompts, type PromptRegistrar } from '../prompts/registry.js';
import { SiteState } from '../site/state.js';
import type { ToolRegistrar } from '../tools/types.js';

interface ToolResult {
  isError?: boolean;
  content?: Array<{ type: string; text: string }>;
}

type ToolHandler = (args: Record<string, unknown>, extra: unknown) => Promise<ToolResult>;

/** Creates a minimal mock server that captures tool registrations for testing */
function createMockServer(): { server: ToolRegistrar; tools: Record<string, { handler: ToolHandler }> } {
  const tools: Record<string, { handler: ToolHandler }> = {};
  // Cast needed because mock doesn't implement full SDK callback signature
  const server = {
    registerTool(name: string, _meta: Record<string, unknown>, handler: ToolHandler) {
      tools[name] = { handler };
    },
  } as ToolRegistrar;
  return { server, tools };
}

test('registers built-in tools', async () => {
  const logger = new Logger('silent');
  const siteState = new SiteState({ logger, timeoutMs: 5000, defaultAuth: { type: 'none' } });

  test('registers write-enabled tools when allowWrites=true', async () => {
    const logger = new Logger('silent');
    const siteState = new SiteState({ logger, timeoutMs: 5000, defaultAuth: { type: 'none' } });

    const { server, tools } = createMockServer();

    await registerAllTools(server, siteState, logger, { allowWrites: true, toolsMode: 'discourse_api_only' } satisfies RegistryOptions);

    // When writes are enabled, create and update tools should be registered
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

    await registerAllTools(server, siteState, logger, { allowWrites: false, toolsMode: 'discourse_api_only' } satisfies RegistryOptions);

    // Write tools should NOT be registered
    assert.ok(!('discourse_create_post' in tools));
    assert.ok(!('discourse_create_topic' in tools));
    assert.ok(!('discourse_update_topic' in tools));
    assert.ok(!('discourse_update_user' in tools));

    // Read tools should still be registered
    assert.ok('discourse_search' in tools);
    assert.ok('discourse_read_topic' in tools);
  });

  const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: { listChanged: false } } });

  await registerAllTools(server, siteState, logger, { allowWrites: false, toolsMode: 'discourse_api_only' } satisfies RegistryOptions);

  // If no error is thrown we consider registration successful.
  assert.ok(true);
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
    await registerAllTools(server, siteState, logger, { allowWrites: false, toolsMode: 'discourse_api_only', hideSelectSite: true } satisfies RegistryOptions);

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

    await registerAllTools(server, siteState, logger, { allowWrites: false, toolsMode: 'discourse_api_only', defaultSearchPrefix: 'tag:ai order:latest' } satisfies RegistryOptions);

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

// Define expected tool sets for each context
const READ_ONLY_TOOLS = [
  'discourse_select_site',
  'discourse_search',
  'discourse_filter_topics',
  'discourse_read_topic',
  'discourse_read_post',
  'discourse_get_user',
  'discourse_list_user_posts',
  'discourse_get_chat_messages',
  'discourse_get_draft',
];

// Admin-only tools are now always registered; access is checked at call time
const ADMIN_READ_TOOLS = [
  'discourse_list_users',
  'discourse_get_query',
  'discourse_run_query',
];

const WRITE_TOOLS = [
  'discourse_create_post',
  'discourse_create_user',
  'discourse_create_category',
  'discourse_create_topic',
  'discourse_update_topic',
  'discourse_update_user',
  'discourse_upload_file',
  'discourse_save_draft',
  'discourse_delete_draft',
  'discourse_create_query',
  'discourse_update_query',
  'discourse_delete_query',
];

test('read-only mode registers read + admin-read tools (access checked at call time)', async () => {
  const logger = new Logger('silent');
  const siteState = new SiteState({ logger, timeoutMs: 5000, defaultAuth: { type: 'none' } });
  const { server, tools } = createMockServer();

  await registerAllTools(server, siteState, logger, {
    allowWrites: false,
    toolsMode: 'discourse_api_only'
  });

  const registeredTools = Object.keys(tools).sort();
  const expectedTools = [...READ_ONLY_TOOLS, ...ADMIN_READ_TOOLS].sort();
  assert.deepEqual(registeredTools, expectedTools);
});

test('write mode registers all tools', async () => {
  const logger = new Logger('silent');
  const siteState = new SiteState({ logger, timeoutMs: 5000, defaultAuth: { type: 'none' } });
  const { server, tools } = createMockServer();

  await registerAllTools(server, siteState, logger, {
    allowWrites: true,
    toolsMode: 'discourse_api_only'
  });

  const registeredTools = Object.keys(tools).sort();
  const expectedTools = [...READ_ONLY_TOOLS, ...ADMIN_READ_TOOLS, ...WRITE_TOOLS].sort();
  assert.deepEqual(registeredTools, expectedTools);
});

test('tethered mode hides select_site from tool list', async () => {
  const logger = new Logger('silent');
  const siteState = new SiteState({ logger, timeoutMs: 5000, defaultAuth: { type: 'none' } });
  const { server, tools } = createMockServer();

  await registerAllTools(server, siteState, logger, {
    allowWrites: false,
    toolsMode: 'discourse_api_only',
    hideSelectSite: true
  });

  const registeredTools = Object.keys(tools).sort();
  const expectedTools = [...READ_ONLY_TOOLS, ...ADMIN_READ_TOOLS].filter(t => t !== 'discourse_select_site').sort();
  assert.deepEqual(registeredTools, expectedTools);
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
