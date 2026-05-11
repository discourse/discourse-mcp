import test from 'node:test';
import assert from 'node:assert/strict';
import { Logger } from '../util/logger.js';
import { HttpClient } from '../http/client.js';
import { SiteState } from '../site/state.js';
import { registerAllTools, type RegistryOptions } from '../tools/registry.js';
import type { ToolRegistrar } from '../tools/types.js';

interface ToolResult {
  isError?: boolean;
  content?: Array<{ type: string; text: string }>;
}

type ToolHandler = (args: Record<string, unknown>, extra: unknown) => Promise<ToolResult>;

function createMockServer(): { server: ToolRegistrar; tools: Record<string, { handler: ToolHandler }> } {
  const tools: Record<string, { handler: ToolHandler }> = {};
  const server = {
    registerTool(name: string, _meta: Record<string, unknown>, handler: ToolHandler) {
      tools[name] = { handler };
    },
  } as ToolRegistrar;
  return { server, tools };
}

function mockJsonFetch(calls: string[]) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push(url);
    if (url.endsWith('/about.json')) {
      return new Response(JSON.stringify({ about: { title: 'Example Discourse' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.includes('/search.json')) {
      return new Response(JSON.stringify({ topics: [{ id: 123, title: 'Hello World', slug: 'hello-world' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.endsWith('/site.json')) {
      return new Response(JSON.stringify({ site: { title: 'Example Discourse' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

test('SiteState preserves and normalizes subfolder base paths', () => {
  const logger = new Logger('silent');
  const siteState = new SiteState({ logger, timeoutMs: 5000, defaultAuth: { type: 'none' } });

  const first = siteState.buildClientForSite('https://example.com/forum');
  const second = siteState.buildClientForSite('https://example.com/forum/');

  assert.equal(first.base, 'https://example.com/forum');
  assert.equal(second.base, 'https://example.com/forum');
  assert.equal(first.client, second.client);
});

test('HttpClient routes leading-slash paths under subfolder base', async () => {
  const calls: string[] = [];
  const restoreFetch = mockJsonFetch(calls);
  const logger = new Logger('silent');
  const client = new HttpClient({ baseUrl: 'https://example.com/forum', timeoutMs: 5000, logger, auth: { type: 'none' } });

  try {
    await client.get('/about.json');
    assert.equal(calls[0], 'https://example.com/forum/about.json');
  } finally {
    restoreFetch();
  }
});

test('HttpClient root base still routes leading-slash paths from origin root', async () => {
  const calls: string[] = [];
  const restoreFetch = mockJsonFetch(calls);
  const logger = new Logger('silent');
  const client = new HttpClient({ baseUrl: 'https://example.com', timeoutMs: 5000, logger, auth: { type: 'none' } });

  try {
    await client.get('/about.json');
    assert.equal(calls[0], 'https://example.com/about.json');
  } finally {
    restoreFetch();
  }
});

test('HttpClient getCached cache key preserves subfolder base path', async () => {
  const calls: string[] = [];
  const restoreFetch = mockJsonFetch(calls);
  const logger = new Logger('silent');
  const client = new HttpClient({ baseUrl: 'https://example.com/forum', timeoutMs: 5000, logger, auth: { type: 'none' } });

  try {
    await client.getCached('/site.json', 60_000);
    await client.getCached('/site.json', 60_000);
    assert.deepEqual(calls, ['https://example.com/forum/site.json']);
  } finally {
    restoreFetch();
  }
});

test('select-site then search flow preserves subfolder base path', async () => {
  const logger = new Logger('silent');
  const siteState = new SiteState({ logger, timeoutMs: 5000, defaultAuth: { type: 'none' } });
  const { server, tools } = createMockServer();
  const calls: string[] = [];
  const restoreFetch = mockJsonFetch(calls);

  try {
    await registerAllTools(server, siteState, logger, { allowWrites: false, toolsMode: 'discourse_api_only' } satisfies RegistryOptions);

    const selectRes = await tools['discourse_select_site'].handler({ site: 'https://example.com/forum' }, {});
    assert.equal(selectRes?.isError, undefined);

    const searchRes = await tools['discourse_search'].handler({ query: 'hello' }, {});
    assert.equal(searchRes?.isError, undefined);

    assert.equal(calls[0], 'https://example.com/forum/about.json');
    assert.ok(calls[1]?.startsWith('https://example.com/forum/search.json?'));
  } finally {
    restoreFetch();
  }
});

test('tethered validation then search preserves subfolder base path', async () => {
  const logger = new Logger('silent');
  const siteState = new SiteState({ logger, timeoutMs: 5000, defaultAuth: { type: 'none' } });
  const { server, tools } = createMockServer();
  const calls: string[] = [];
  const restoreFetch = mockJsonFetch(calls);

  try {
    const { base, client } = siteState.buildClientForSite('https://example.com/forum');
    await client.get('/about.json');
    siteState.selectSite(base);

    await registerAllTools(server, siteState, logger, { allowWrites: false, toolsMode: 'discourse_api_only', hideSelectSite: true } satisfies RegistryOptions);
    assert.ok(!('discourse_select_site' in tools));

    const searchRes = await tools['discourse_search'].handler({ query: 'hello' }, {});
    assert.equal(searchRes?.isError, undefined);

    assert.equal(calls[0], 'https://example.com/forum/about.json');
    assert.ok(calls[1]?.startsWith('https://example.com/forum/search.json?'));
  } finally {
    restoreFetch();
  }
});
