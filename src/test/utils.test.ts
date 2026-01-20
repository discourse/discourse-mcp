import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { parseArgs } from '../util/cli.js';
import { zodError, isZodError } from '../util/json_response.js';

// parseArgs tests

test('parseArgs handles --flag=value syntax', () => {
  const result = parseArgs(['--site=https://example.com', '--timeout-ms=5000']);
  assert.equal(result.site, 'https://example.com');
  assert.equal(result['timeout-ms'], 5000);
});

test('parseArgs handles --flag value syntax', () => {
  const result = parseArgs(['--site', 'https://example.com', '--timeout-ms', '5000']);
  assert.equal(result.site, 'https://example.com');
  assert.equal(result['timeout-ms'], 5000);
});

test('parseArgs treats values beginning with single dash as values, not flags', () => {
  // Critical for Discourse search negation like -tag:foo
  const result = parseArgs(['--default-search', '-tag:foo']);
  assert.equal(result['default-search'], '-tag:foo');
});

test('parseArgs handles -h as a short flag', () => {
  const result = parseArgs(['-h']);
  assert.equal(result.h, true);
});

test('parseArgs does not treat -tag:foo as a flag when standalone', () => {
  // Values starting with - that aren't followed by a flag name shouldn't become flags
  const result = parseArgs(['-tag:foo']);
  assert.equal(result['tag:foo'], undefined);
  assert.equal(result['-tag:foo'], undefined);
});

test('parseArgs coerces boolean strings', () => {
  const result = parseArgs(['--read-only', 'true', '--allow-writes', 'false']);
  assert.equal(result['read-only'], true);
  assert.equal(result['allow-writes'], false);
});

test('parseArgs coerces numeric strings', () => {
  const result = parseArgs(['--port', '3000', '--timeout-ms', '15000']);
  assert.equal(result.port, 3000);
  assert.equal(result['timeout-ms'], 15000);
});

test('parseArgs handles boolean flags without values', () => {
  const result = parseArgs(['--verbose', '--debug']);
  assert.equal(result.verbose, true);
  assert.equal(result.debug, true);
});

test('parseArgs rawStrings option prevents coercion', () => {
  const result = parseArgs(['--nonce', '007', '--port', '3000'], { rawStrings: true });
  // With rawStrings, values stay as strings (important for nonce/payload)
  assert.equal(result.nonce, '007');
  assert.equal(result.port, '3000');
});

test('parseArgs ignores non-flag arguments', () => {
  const result = parseArgs(['generate-user-api-key', '--site', 'https://example.com']);
  assert.equal(result.site, 'https://example.com');
  assert.equal(result['generate-user-api-key'], undefined);
});

test('parseArgs handles mixed --flag=value and --flag value syntax', () => {
  const result = parseArgs(['--site=https://example.com', '--timeout-ms', '5000', '--read-only=true']);
  assert.equal(result.site, 'https://example.com');
  assert.equal(result['timeout-ms'], 5000);
  assert.equal(result['read-only'], true);
});

// zodError tests

test('zodError formats single field error', () => {
  const schema = z.object({ name: z.string() });
  try {
    schema.parse({ name: 123 });
    assert.fail('Should have thrown');
  } catch (e) {
    assert.ok(isZodError(e));
    const result = zodError(e);
    assert.equal(result.isError, true);
    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed.error, 'Validation failed');
    assert.ok(Array.isArray(parsed.issues));
    assert.equal(parsed.issues.length, 1);
    assert.equal(parsed.issues[0].path, 'name');
    assert.ok(parsed.issues[0].message.includes('string'));
  }
});

test('zodError formats multiple field errors', () => {
  const schema = z.object({
    name: z.string(),
    age: z.number().int().positive(),
  });
  try {
    schema.parse({ name: 123, age: -5 });
    assert.fail('Should have thrown');
  } catch (e) {
    assert.ok(isZodError(e));
    const result = zodError(e);
    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed.issues.length, 2);
    const paths = parsed.issues.map((i: { path: string }) => i.path);
    assert.ok(paths.includes('name'));
    assert.ok(paths.includes('age'));
  }
});

test('zodError formats nested path errors', () => {
  const schema = z.object({
    user: z.object({
      email: z.string().email(),
    }),
  });
  try {
    schema.parse({ user: { email: 'not-an-email' } });
    assert.fail('Should have thrown');
  } catch (e) {
    assert.ok(isZodError(e));
    const result = zodError(e);
    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed.issues[0].path, 'user.email');
  }
});

test('zodError formats root-level errors', () => {
  const schema = z.string();
  try {
    schema.parse(123);
    assert.fail('Should have thrown');
  } catch (e) {
    assert.ok(isZodError(e));
    const result = zodError(e);
    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed.issues[0].path, '(root)');
  }
});

test('isZodError returns false for non-Zod errors', () => {
  assert.equal(isZodError(new Error('regular error')), false);
  assert.equal(isZodError(null), false);
  assert.equal(isZodError(undefined), false);
  assert.equal(isZodError({ message: 'fake error' }), false);
});
