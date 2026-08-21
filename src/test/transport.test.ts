import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ask the OS for an available loopback port instead of guessing a range.
async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (!address || typeof address === 'string') {
        probe.close();
        reject(new Error('Unable to allocate a test port'));
        return;
      }
      const { port } = address;
      probe.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

// Helper to wait for server to be ready
async function waitForServer(port: number, maxAttempts = 10): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(`http://localhost:${port}/health`);
      if (response.ok) return true;
    } catch {
      // Server not ready yet
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return false;
}

async function postMcpRequest(
  port: number,
  payload: Record<string, unknown>,
  headers: Record<string, string>
): Promise<{ statusCode: number | undefined; body: string; sessionId: string | undefined }> {
  const requestBody = JSON.stringify(payload);

  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/mcp',
        method: 'POST',
        headers: {
          Accept: 'application/json, text/event-stream',
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(requestBody).toString(),
          ...headers,
        },
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => resolve({
          statusCode: res.statusCode,
          body,
          sessionId: typeof res.headers['mcp-session-id'] === 'string'
            ? res.headers['mcp-session-id']
            : undefined,
        }));
      }
    );

    req.on('error', reject);
    req.end(requestBody);
  });
}

async function postMcp(
  port: number,
  headers: Record<string, string>
): Promise<{ statusCode: number | undefined; body: string; sessionId: string | undefined }> {
  return postMcpRequest(port, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'transport-test', version: '1.0.0' },
    },
  }, headers);
}

test('HTTP transport starts on specified port', async () => {
  const port = await getFreePort();
  const indexPath = path.resolve(__dirname, '../../dist/index.js');

  const serverProcess = spawn('node', [
    indexPath,
    '--transport', 'http',
    '--port', String(port),
    '--log_level', 'silent'
  ], {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    const ready = await waitForServer(port);
    assert.ok(ready, 'Server should start successfully');
  } finally {
    serverProcess.kill('SIGTERM');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
});

test('HTTP transport health endpoint returns ok', async () => {
  const port = await getFreePort();
  const indexPath = path.resolve(__dirname, '../../dist/index.js');

  const serverProcess = spawn('node', [
    indexPath,
    '--transport', 'http',
    '--port', String(port),
    '--log_level', 'silent'
  ], {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    const ready = await waitForServer(port);
    assert.ok(ready, 'Server should start');

    const response = await fetch(`http://localhost:${port}/health`);
    assert.equal(response.status, 200);

    const data = await response.json();
    assert.deepEqual(data, { status: 'ok', session_model: 'single_client' });
  } finally {
    serverProcess.kill('SIGTERM');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
});

test('HTTP transport accepts MCP requests from local hosts without an origin', async () => {
  const port = await getFreePort();
  const indexPath = path.resolve(__dirname, '../../dist/index.js');

  const serverProcess = spawn('node', [
    indexPath,
    '--transport', 'http',
    '--port', String(port),
    '--log_level', 'silent'
  ], {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    const ready = await waitForServer(port);
    assert.ok(ready, 'Server should start');

    const response = await postMcp(port, {
      Host: `127.0.0.1:${port}`,
    });

    assert.equal(response.statusCode, 200);
    assert.match(response.body, /"id":1/);
  } finally {
    serverProcess.kill('SIGTERM');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
});

test('invalid CLI toolsets fail startup with actionable output', () => {
  const indexPath = path.resolve(__dirname, '../../dist/index.js');
  const result = spawnSync('node', [indexPath, '--toolsets'], {
    encoding: 'utf8',
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /expected a comma-separated string or string array/);
  assert.match(result.stderr, /data_explorer/);
});

test('CLI toolsets override profile toolsets and are reflected by MCP tools/list', async () => {
  const port = await getFreePort();
  const indexPath = path.resolve(__dirname, '../../dist/index.js');
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'discourse-mcp-toolsets-'));
  const profilePath = path.join(tempDirectory, 'profile.json');
  await writeFile(profilePath, JSON.stringify({
    toolsets: ['users'],
    tools_mode: 'discourse_api_only',
  }));
  const serverProcess = spawn('node', [
    indexPath,
    '--profile', profilePath,
    '--transport', 'http',
    '--port', String(port),
    '--log_level', 'silent',
    '--toolsets', 'data_explorer'
  ], {
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const headers = { Host: `127.0.0.1:${port}` };

  try {
    const ready = await waitForServer(port);
    assert.ok(ready, 'Server should start with selected toolsets');
    const initialization = await postMcp(port, headers);
    assert.equal(initialization.statusCode, 200);
    assert.ok(initialization.sessionId);

    const response = await postMcpRequest(port, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    }, { ...headers, 'Mcp-Session-Id': initialization.sessionId });
    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body) as {
      result?: { tools?: Array<{ name: string }> };
    };
    assert.deepEqual(body.result?.tools?.map((tool) => tool.name), [
      'discourse_select_site',
      'discourse_get_query',
      'discourse_run_query'
    ]);
  } finally {
    serverProcess.kill('SIGTERM');
    await new Promise(resolve => setTimeout(resolve, 100));
    await rm(tempDirectory, { recursive: true, force: true });
  }
});

test('profile toolsets apply when the CLI does not override them', async () => {
  const port = await getFreePort();
  const indexPath = path.resolve(__dirname, '../../dist/index.js');
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'discourse-mcp-toolsets-'));
  const profilePath = path.join(tempDirectory, 'profile.json');
  await writeFile(profilePath, JSON.stringify({
    toolsets: ['users'],
    tools_mode: 'discourse_api_only',
  }));
  const serverProcess = spawn('node', [
    indexPath,
    '--profile', profilePath,
    '--transport', 'http',
    '--port', String(port),
    '--log_level', 'silent'
  ], {
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const headers = { Host: `127.0.0.1:${port}` };

  try {
    const ready = await waitForServer(port);
    assert.ok(ready, 'Server should start with profile toolsets');
    const initialization = await postMcp(port, headers);
    assert.equal(initialization.statusCode, 200);
    assert.ok(initialization.sessionId);

    const response = await postMcpRequest(port, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    }, { ...headers, 'Mcp-Session-Id': initialization.sessionId });
    const body = JSON.parse(response.body) as {
      result?: { tools?: Array<{ name: string }> };
    };
    assert.deepEqual(body.result?.tools?.map((tool) => tool.name), [
      'discourse_select_site',
      'discourse_get_user',
      'discourse_list_user_posts',
      'discourse_list_users'
    ]);
  } finally {
    serverProcess.kill('SIGTERM');
    await new Promise(resolve => setTimeout(resolve, 100));
    await rm(tempDirectory, { recursive: true, force: true });
  }
});

test('HTTP transport rejects MCP requests from non-local hosts and origins', async () => {
  const port = await getFreePort();
  const indexPath = path.resolve(__dirname, '../../dist/index.js');

  const serverProcess = spawn('node', [
    indexPath,
    '--transport', 'http',
    '--port', String(port),
    '--log_level', 'silent'
  ], {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    const ready = await waitForServer(port);
    assert.ok(ready, 'Server should start');

    const response = await postMcp(port, {
      Host: 'evil.example',
      Origin: 'http://evil.example',
    });

    assert.equal(response.statusCode, 403);
    assert.match(response.body, /Invalid (Host|Origin) header/);
  } finally {
    serverProcess.kill('SIGTERM');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
});

test('HTTP transport rejects MCP requests from non-local origins', async () => {
  const port = await getFreePort();
  const indexPath = path.resolve(__dirname, '../../dist/index.js');

  const serverProcess = spawn('node', [
    indexPath,
    '--transport', 'http',
    '--port', String(port),
    '--log_level', 'silent'
  ], {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    const ready = await waitForServer(port);
    assert.ok(ready, 'Server should start');

    const response = await postMcp(port, {
      Host: `127.0.0.1:${port}`,
      Origin: 'http://evil.example',
    });

    assert.equal(response.statusCode, 403);
    assert.match(response.body, /Invalid Origin header/);
  } finally {
    serverProcess.kill('SIGTERM');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
});

test('stdio transport is the default', async () => {
  const port = await getFreePort();
  const indexPath = path.resolve(__dirname, '../../dist/index.js');

  // Start with no transport flag - should use stdio
  const serverProcess = spawn('node', [
    indexPath,
    '--port', String(port),
    '--log_level', 'silent'
  ], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  // Give it a moment to potentially start HTTP server (which it shouldn't)
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Try to connect to the configured HTTP port - should fail
  try {
    await fetch(`http://localhost:${port}/health`, { signal: AbortSignal.timeout(500) });
    assert.fail('Should not have HTTP server running in stdio mode');
  } catch (error: any) {
    // Expected - no HTTP server should be running
    assert.ok(error.name === 'AbortError' || error.cause?.code === 'ECONNREFUSED');
  } finally {
    serverProcess.kill('SIGTERM');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
});

test('HTTP transport enforces one stateful client and requires the initialized session', async () => {
  const port = await getFreePort();
  const indexPath = path.resolve(__dirname, '../../dist/index.js');
  const serverProcess = spawn('node', [indexPath, '--transport', 'http', '--port', String(port), '--log_level', 'silent'], {
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const headers = { Host: `127.0.0.1:${port}` };
  try {
    assert.ok(await waitForServer(port));
    const initialized = await postMcp(port, headers);
    assert.equal(initialized.statusCode, 200);
    assert.ok(initialized.sessionId);

    const missing = await postMcpRequest(port, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, headers);
    assert.equal(missing.statusCode, 400);
    assert.match(missing.body, /session/i);

    const unknown = await postMcpRequest(port, { jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} }, {
      ...headers, 'Mcp-Session-Id': 'different-client-session'
    });
    assert.equal(unknown.statusCode, 404);
    assert.match(unknown.body, /Session not found/);
    assert.doesNotMatch(unknown.body, /discourse_search/);

    const secondInitialize = await postMcp(port, headers);
    assert.equal(secondInitialize.statusCode, 400);
    assert.match(secondInitialize.body, /already initialized/);
    assert.doesNotMatch(secondInitialize.body, /discourse_search/);

    const originalClient = await postMcpRequest(port, { jsonrpc: '2.0', id: 4, method: 'tools/list', params: {} }, {
      ...headers, 'Mcp-Session-Id': initialized.sessionId!
    });
    assert.equal(originalClient.statusCode, 200);
    assert.match(originalClient.body, /discourse_search/);
  } finally {
    serverProcess.kill('SIGTERM');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
});

test('HTTP DELETE closes the sole session and makes restart-required state explicit', async () => {
  const port = await getFreePort();
  const indexPath = path.resolve(__dirname, '../../dist/index.js');
  const serverProcess = spawn('node', [indexPath, '--transport', 'http', '--port', String(port), '--log_level', 'silent'], {
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const headers = { Host: `127.0.0.1:${port}` };
  try {
    assert.ok(await waitForServer(port));
    const initialized = await postMcp(port, headers);
    assert.ok(initialized.sessionId);
    const closed = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'DELETE',
      headers: {
        Accept: 'application/json, text/event-stream',
        'Mcp-Session-Id': initialized.sessionId!,
        'Mcp-Protocol-Version': '2025-03-26',
      },
    });
    assert.equal(closed.status, 200);

    const health = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(health.status, 503);
    assert.match(await health.text(), /restart_required/);
    const reconnect = await postMcp(port, headers);
    assert.equal(reconnect.statusCode, 410);
    assert.match(reconnect.body, /restart/i);
  } finally {
    serverProcess.kill('SIGTERM');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
});

test('HTTP transport rejects oversized pre-read bodies before JSON parsing', async () => {
  const port = await getFreePort();
  const indexPath = path.resolve(__dirname, '../../dist/index.js');
  const serverProcess = spawn('node', [indexPath, '--transport', 'http', '--port', String(port), '--log_level', 'silent'], {
    stdio: ['ignore', 'pipe', 'pipe']
  });
  try {
    assert.ok(await waitForServer(port));
    const response = await postMcpRequest(port, {
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: {
        protocolVersion: '2025-03-26', capabilities: {},
        clientInfo: { name: 'x'.repeat(4 * 1024 * 1024), version: '1' },
      },
    }, { Host: `127.0.0.1:${port}` });
    assert.equal(response.statusCode, 413);
    assert.match(response.body, /exceeds/);
    const health = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(health.status, 200);
  } finally {
    serverProcess.kill('SIGTERM');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
});

test('HTTP transport gracefully handles shutdown', async () => {
  const port = await getFreePort();
  const indexPath = path.resolve(__dirname, '../../dist/index.js');

  const serverProcess = spawn('node', [
    indexPath,
    '--transport', 'http',
    '--port', String(port),
    '--log_level', 'silent'
  ], {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    const ready = await waitForServer(port);
    assert.ok(ready, 'Server should start');
    const initialized = await postMcp(port, { Host: `127.0.0.1:${port}` });
    assert.equal(initialized.statusCode, 200);
    assert.ok(initialized.sessionId);

    // Send SIGTERM while an active MCP session exists.
    serverProcess.kill('SIGTERM');

    // Wait for graceful shutdown
    await new Promise(resolve => setTimeout(resolve, 500));

    // Server should be down
    try {
      await fetch(`http://localhost:${port}/health`, { signal: AbortSignal.timeout(500) });
      assert.fail('Server should be shut down');
    } catch (error: any) {
      // Expected
      assert.ok(error.name === 'AbortError' || error.cause?.code === 'ECONNREFUSED');
    }
  } finally {
    serverProcess.kill('SIGKILL'); // Ensure cleanup
    await new Promise(resolve => setTimeout(resolve, 100));
  }
});
