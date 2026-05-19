import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
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

test('HttpClient cookie_file auth sends matching cookies', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'discourse-mcp-cookie-'));
  const cookieFile = path.join(dir, 'cookies.json');
  await writeFile(cookieFile, JSON.stringify({
    cookies: [
      { name: '_t', value: 'secret-token', domain: '.example.com', path: '/', expires: -1 },
      { name: 'ignored', value: 'nope', domain: '.elsewhere.com', path: '/', expires: -1 },
    ],
  }), 'utf8');

  const originalFetch = globalThis.fetch;
  let cookieHeader = '';
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    cookieHeader = String((init?.headers as Record<string, string>)?.Cookie || '');
    return new Response(JSON.stringify({ about: { title: 'Example Discourse' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;

  try {
    const logger = new Logger('silent');
    const client = new HttpClient({
      baseUrl: 'https://example.com',
      timeoutMs: 5000,
      logger,
      auth: { type: 'cookie', cookieFile },
    });

    await client.get('/about.json');
    assert.equal(cookieHeader, '_t=secret-token');
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test('HttpClient cookie auth fetches CSRF token for writes', async () => {
  const logger = new Logger('silent');
  const client = new HttpClient({
    baseUrl: 'https://example.com',
    timeoutMs: 5000,
    logger,
    auth: { type: 'cookie', cookie: '_t=secret-token' },
  });

  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers = (init?.headers || {}) as Record<string, string>;
    calls.push({ url, headers });

    if (url.endsWith('/session/csrf.json')) {
      return new Response(JSON.stringify({ csrf: 'csrf-token' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.endsWith('/posts.json')) {
      return new Response(JSON.stringify({ id: 1, topic_id: 2, post_number: 1 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;

  try {
    await client.post('/posts.json', { raw: 'hello' });
    assert.equal(calls[0]?.url, 'https://example.com/session/csrf.json');
    assert.equal(calls[0]?.headers.Cookie, '_t=secret-token');
    assert.equal(calls[1]?.url, 'https://example.com/posts.json');
    assert.equal(calls[1]?.headers.Cookie, '_t=secret-token');
    assert.equal(calls[1]?.headers['X-CSRF-Token'], 'csrf-token');
  } finally {
    globalThis.fetch = originalFetch;
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
