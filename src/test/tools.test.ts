import test from 'node:test';
import assert from 'node:assert/strict';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Logger } from '../util/logger.js';
import { registerAllTools } from '../tools/registry.js';
import { SiteState } from '../site/state.js';

function createFakeTransport() {
  // Minimal stub transport to allow server.connect to proceed without a client.
  // We won't actually send/receive messages; we only verify registration doesn't throw.
  return new StdioServerTransport({
    stdin: new ReadableStream(),
    stdout: new WritableStream(),
  } as any);
}

test('registers built-in tools', async () => {
  const logger = new Logger('silent');
  const siteState = new SiteState({ logger, timeoutMs: 5000, defaultAuth: { type: 'none' } });

test('registers write-enabled tools when allowWrites=true', async () => {
  const logger = new Logger('silent');
  const siteState = new SiteState({ logger, timeoutMs: 5000, defaultAuth: { type: 'none' } });

  // Minimal fake server to capture tool registrations
  const tools: Record<string, { handler: Function }> = {};
  const fakeServer: any = {
    registerTool(name: string, _meta: any, handler: Function) {
      tools[name] = { handler };
    },
  };

  await registerAllTools(fakeServer, siteState, logger, { allowWrites: true, toolsMode: 'discourse_api_only' } as any);

  // When writes are enabled, both create tools should be registered
  assert.ok('discourse_create_post' in tools);
  assert.ok('discourse_create_category' in tools);
});
  const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: { listChanged: false } } });

  await registerAllTools(server as any, siteState, logger, { allowWrites: false, toolsMode: 'discourse_api_only' });

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

  // Minimal fake server to capture tool handlers
  const tools: Record<string, { handler: Function }> = {};
  const fakeServer: any = {
    registerTool(name: string, _meta: any, handler: Function) {
      tools[name] = { handler };
    },
  };

  await registerAllTools(fakeServer, siteState, logger, { allowWrites: false, toolsMode: 'discourse_api_only' });

  // Mock fetch
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any, _init?: any) => {
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

    // Search
    const searchRes = await tools['discourse_search'].handler({ query: 'hello' }, {});
    const text = String(searchRes?.content?.[0]?.text || '');
    assert.match(text, /Top results/);
    assert.match(text, /hello-world/);
  } finally {
    globalThis.fetch = originalFetch as any;
  }
});

// Tethered mode: preselect site via --site and hide select_site
test('tethered mode hides select_site and allows search without selection', async () => {
  const logger = new Logger('silent');
  const siteState = new SiteState({ logger, timeoutMs: 5000, defaultAuth: { type: 'none' } });

  // Minimal fake server to capture tool handlers
  const tools: Record<string, { handler: Function }> = {};
  const fakeServer: any = {
    registerTool(name: string, _meta: any, handler: Function) {
      tools[name] = { handler };
    },
  };

  // Mock fetch
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any, _init?: any) => {
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
    await registerAllTools(fakeServer, siteState, logger, { allowWrites: false, toolsMode: 'discourse_api_only', hideSelectSite: true } as any);

    // Ensure select tool is not exposed
    assert.ok(!('discourse_select_site' in tools));

    // Search should work without calling select first
    const searchRes = await tools['discourse_search'].handler({ query: 'hello' }, {});
    const text = String(searchRes?.content?.[0]?.text || '');
    assert.match(text, /Top results/);
    assert.match(text, /hello-world/);
  } finally {
    globalThis.fetch = originalFetch as any;
  }
});

test('default-search prefix is applied to queries', async () => {
  const logger = new Logger('silent');
  const siteState = new SiteState({ logger, timeoutMs: 5000, defaultAuth: { type: 'none' } });

  const tools: Record<string, { handler: Function }> = {};
  const fakeServer: any = {
    registerTool(name: string, _meta: any, handler: Function) {
      tools[name] = { handler };
    },
  };

  // Mock fetch to capture the search URL
  let lastUrl: string | undefined;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any, _init?: any) => {
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

    await registerAllTools(fakeServer, siteState, logger, { allowWrites: false, toolsMode: 'discourse_api_only', defaultSearchPrefix: 'tag:ai order:latest-post' } as any);

    await tools['discourse_search'].handler({ query: 'hello world' }, {});
    assert.ok(lastUrl && lastUrl.includes('/search.json?'));
    const qs = lastUrl!.split('?')[1] || '';
    const params = new URLSearchParams(qs);
    assert.equal(params.get('expanded'), 'true');
    assert.equal(params.get('q'), 'tag:ai order:latest-post hello world');
  } finally {
    globalThis.fetch = originalFetch as any;
  }
});

test('search tool also returns post ids', async () => {
  const logger = new Logger('silent');
  const siteState = new SiteState({ logger, timeoutMs: 5000, defaultAuth: { type: 'none' } });
  const tools: Record<string, { handler: Function }> = {};
  const fakeServer: any = {
    registerTool(name: string, _meta: any, handler: Function) {
      tools[name] = { handler };
    },
  };

  // Mock fetch to capture the search URL
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any, _init?: any) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.endsWith('/about.json')) {
      return new Response(JSON.stringify({ about: { title: 'Example Discourse' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.includes('/search.json')) {
      return new Response(JSON.stringify({ topics: [{ id: 123, title: 'Hello World', slug: 'hello-world' }], posts: [{ id: 456, topic_id: 123 }, { id: 789, topic_id: 123 }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('not found', { status: 404 });
  }) as any;

  try {
    const { base, client } = siteState.buildClientForSite('https://example.com');
    await client.get('/about.json');
    siteState.selectSite(base);
    await registerAllTools(fakeServer, siteState, logger, { allowWrites: false, toolsMode: 'discourse_api_only', defaultSearchPrefix: 'tag:ai order:latest-post' } as any);
    const searchRes = await tools['discourse_search'].handler({ query: 'hello world' }, {});
    const text = String(searchRes?.content?.[0]?.text || '');
    assert.match(text, /456/);
    assert.match(text, /789/);
  } finally {
    globalThis.fetch = originalFetch as any;
  }
});