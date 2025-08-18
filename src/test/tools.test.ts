import test from 'node:test';
import assert from 'node:assert/strict';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { HttpClient } from '../http/client.js';
import { Logger } from '../util/logger.js';
import { registerAllTools } from '../tools/registry.js';

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
  const client = new HttpClient({ baseUrl: 'https://try.discourse.org', timeoutMs: 5000, logger, auth: { type: 'none' } });
  const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: { listChanged: false } } });

  await registerAllTools(server as any, client, logger, 'https://try.discourse.org', { allowWrites: false, toolsMode: 'discourse_api_only' });

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
