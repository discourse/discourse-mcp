import test from "node:test";
import assert from "node:assert/strict";
import { withRateLimit } from "../util/json_response.js";

test("withRateLimit serializes concurrent operations and spaces their starts", async () => {
  const starts: number[] = [];
  let active = 0;
  let maxActive = 0;
  const key = `test-${Date.now()}-${Math.random()}`;

  await Promise.all(Array.from({ length: 3 }, () => withRateLimit(key, async () => {
    starts.push(Date.now());
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
  }, 15)));

  assert.equal(maxActive, 1);
  assert.equal(starts.length, 3);
  assert.ok(starts[1]! - starts[0]! >= 10, `first gap was ${starts[1]! - starts[0]!}ms`);
  assert.ok(starts[2]! - starts[1]! >= 10, `second gap was ${starts[2]! - starts[1]!}ms`);
});
