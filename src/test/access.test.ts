import test from "node:test";
import assert from "node:assert/strict";
import { Logger } from "../util/logger.js";
import { SiteState } from "../site/state.js";
import { requireAuthenticatedAccess } from "../util/access.js";

function errorText(result: ReturnType<typeof requireAuthenticatedAccess>) {
  return result ? JSON.parse(result.content[0]!.text).error : null;
}

test("requireAuthenticatedAccess requires a selected authenticated site", () => {
  const logger = new Logger("silent");
  const anonymous = new SiteState({ logger, timeoutMs: 1000, defaultAuth: { type: "none" } });
  assert.match(errorText(requireAuthenticatedAccess(anonymous)), /No site selected/);
  anonymous.selectSite("https://example.com");
  assert.match(errorText(requireAuthenticatedAccess(anonymous)), /No auth configured/);

  for (const defaultAuth of [
    { type: "api_key" as const, key: "key" },
    { type: "user_api_key" as const, key: "key" },
  ]) {
    const authenticated = new SiteState({ logger, timeoutMs: 1000, defaultAuth });
    authenticated.selectSite("https://example.com");
    assert.equal(requireAuthenticatedAccess(authenticated), null);
  }
});
