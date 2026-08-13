import test from "node:test";
import assert from "node:assert/strict";
import { Logger } from "../util/logger.js";
import { SiteState } from "../site/state.js";
import { registerAllTools } from "../tools/registry.js";
import type { ToolRegistrar, ToolRegistrationOptions } from "../tools/types.js";

interface ToolResult {
  isError?: boolean;
  content?: Array<{ type: string; text: string }>;
}

type ToolHandler = (
  input: Record<string, unknown>,
  extra: unknown
) => Promise<ToolResult>;

function createMockServer(): {
  server: ToolRegistrar;
  tools: Record<string, { handler: ToolHandler }>;
} {
  const tools: Record<string, { handler: ToolHandler }> = {};
  const server = {
    registerTool(
      name: string,
      _metadata: Record<string, unknown>,
      handler: ToolHandler
    ) {
      tools[name] = { handler };
    },
  } as ToolRegistrar;
  return { server, tools };
}

function responseJson(result: ToolResult): Record<string, unknown> {
  return JSON.parse(result.content?.[0]?.text ?? "{}") as Record<string, unknown>;
}

function createSiteState(
  logger: Logger,
  authenticated = false
): SiteState {
  return new SiteState({
    logger,
    timeoutMs: 5000,
    defaultAuth: authenticated
      ? { type: "api_key", key: "test-key", username: "system" }
      : { type: "none" },
  });
}

const readOptions: ToolRegistrationOptions = {
  allowWrites: false,
  toolsMode: "discourse_api_only",
};

test("shared options preserve ordinary write and admin call-time access checks", async () => {
  const logger = new Logger("silent");
  const siteState = createSiteState(logger);
  siteState.selectSite("https://example.com");
  const { server, tools } = createMockServer();
  await registerAllTools(server, siteState, logger, {
    ...readOptions,
    allowWrites: true,
  });

  const writeResult = await tools.discourse_create_post.handler(
    { topic_id: 1, raw: "body" },
    {}
  );
  assert.equal(writeResult.isError, true);
  assert.deepEqual(responseJson(writeResult), {
    error:
      "No auth configured for selected site (https://example.com). Add a matching auth_pairs entry and restart.",
  });

  const adminReadResult = await tools.discourse_list_users.handler({}, {});
  assert.equal(adminReadResult.isError, true);
  assert.deepEqual(responseJson(adminReadResult), {
    error:
      "No auth configured for selected site (https://example.com). Add a matching auth_pairs entry and restart.",
  });

  const adminWriteResult = await tools.discourse_create_query.handler(
    { name: "query", sql: "SELECT 1" },
    {}
  );
  assert.equal(adminWriteResult.isError, true);
  assert.deepEqual(responseJson(adminWriteResult), {
    error:
      "No auth configured for selected site (https://example.com). Add a matching auth_pairs entry and restart.",
  });
});

test("shared showEmails option reaches get_user and list_users handlers", async () => {
  const logger = new Logger("silent");
  const siteState = createSiteState(logger, true);
  siteState.selectSite("https://example.com");
  const { server, tools } = createMockServer();
  const urls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = input.toString();
    urls.push(url);
    if (url.endsWith("/u/sam.json")) {
      return Response.json({ user: { id: 1, username: "sam" } });
    }
    if (url.endsWith("/u/sam/emails.json")) {
      return Response.json({ email: "sam@example.com" });
    }
    if (url.includes("/admin/users/list/active.json?")) {
      return Response.json([]);
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  try {
    await registerAllTools(server, siteState, logger, {
      ...readOptions,
      showEmails: true,
    });

    const userResult = await tools.discourse_get_user.handler(
      { username: "sam" },
      {}
    );
    assert.equal(responseJson(userResult).email, "sam@example.com");

    await tools.discourse_list_users.handler({}, {});
    const listUrl = urls.find((url) =>
      url.includes("/admin/users/list/active.json?")
    );
    assert.ok(listUrl);
    assert.equal(new URL(listUrl).searchParams.get("show_emails"), "true");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("select_site uses toolsMode and ctx.server for remote registration", async () => {
  const logger = new Logger("silent");
  const siteState = createSiteState(logger);
  const { server, tools } = createMockServer();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = input.toString();
    if (url.endsWith("/about.json")) {
      return Response.json({ about: { title: "Example Discourse" } });
    }
    if (url.endsWith("/ai/tools")) {
      return Response.json({
        tools: [
          {
            name: "fixture.remote",
            description: "Remote fixture",
            inputSchema: { type: "object", properties: {} },
          },
        ],
      });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  try {
    await registerAllTools(server, siteState, logger, {
      allowWrites: false,
      toolsMode: "auto",
    });
    const result = await tools.discourse_select_site.handler(
      { site: "https://example.com" },
      {}
    );
    assert.equal(result.isError, undefined);
    assert.ok("remote_fixture_remote" in tools);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
