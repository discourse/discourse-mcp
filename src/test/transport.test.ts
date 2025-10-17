import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper to get a free port
async function getFreePort(): Promise<number> {
  return 3000 + Math.floor(Math.random() * 1000);
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
    assert.deepEqual(data, { status: 'ok' });
  } finally {
    serverProcess.kill('SIGTERM');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
});

test('stdio transport is the default', async () => {
  const indexPath = path.resolve(__dirname, '../../dist/index.js');

  // Start with no transport flag - should use stdio
  const serverProcess = spawn('node', [
    indexPath,
    '--log_level', 'silent'
  ], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  // Give it a moment to potentially start HTTP server (which it shouldn't)
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Try to connect to default HTTP port - should fail
  try {
    await fetch('http://localhost:3000/health', { signal: AbortSignal.timeout(500) });
    assert.fail('Should not have HTTP server running in stdio mode');
  } catch (error: any) {
    // Expected - no HTTP server should be running
    assert.ok(error.name === 'AbortError' || error.cause?.code === 'ECONNREFUSED');
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

    // Send SIGTERM
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
