import test from "node:test";
import assert from "node:assert/strict";
import { Logger } from "../util/logger.js";
import { SiteState } from "../site/state.js";
import { registerAllTools } from "../tools/registry.js";
import type { ToolRegistrar } from "../tools/types.js";

interface ToolResult {
  isError?: boolean;
  content?: Array<{ type: string; text: string }>;
  structuredContent?: Record<string, unknown>;
}

type ToolHandler = (
  args: Record<string, unknown>,
  extra: unknown
) => Promise<ToolResult>;

interface CapturedTool {
  config: Record<string, any>;
  handler: ToolHandler;
}

function createMockServer(): {
  server: ToolRegistrar;
  tools: Record<string, CapturedTool>;
} {
  const tools: Record<string, CapturedTool> = {};
  const server = {
    registerTool(
      name: string,
      config: Record<string, any>,
      handler: ToolHandler
    ) {
      tools[name] = { config, handler };
      return {};
    },
  } as ToolRegistrar;
  return { server, tools };
}

async function registeredDirectoryTools() {
  const logger = new Logger("silent");
  const siteState = new SiteState({
    logger,
    timeoutMs: 5000,
    defaultAuth: { type: "none" },
  });
  siteState.selectSite("https://example.com");
  const { server, tools } = createMockServer();
  await registerAllTools(server, siteState, logger, {
    allowWrites: false,
    toolsMode: "discourse_api_only",
  });
  return tools;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function parsedText(result: ToolResult): Record<string, unknown> {
  return JSON.parse(result.content?.[0]?.text || "null") as Record<string, unknown>;
}

function assertLeanDirectoryResult(
  result: ToolResult,
  collectionName: "categories" | "groups" | "tag_groups",
  expectedTotal: number
) {
  const entryKeys =
    collectionName === "categories"
      ? ["id", "name", "parent_category_id"]
      : ["id", "name"];

  assert.equal(result.isError, undefined);
  assert.deepEqual(parsedText(result), result.structuredContent);
  assert.deepEqual(Object.keys(result.structuredContent || {}).sort(), [
    collectionName,
    "meta",
  ].sort());

  const items = result.structuredContent?.[collectionName] as Array<Record<string, unknown>>;
  assert.equal(items.length, expectedTotal);
  for (const item of items) {
    assert.deepEqual(Object.keys(item).sort(), entryKeys.sort());
    assert.equal(typeof item.id, "number");
    assert.equal(typeof item.name, "string");
  }
  assert.deepEqual(result.structuredContent?.meta, { total: expectedTotal });
}

test("directory tools use empty inputs, structured outputs, and read-only annotations", async () => {
  const tools = await registeredDirectoryTools();

  const expectedCollections = {
    discourse_list_categories: "categories",
    discourse_list_groups: "groups",
    discourse_list_tag_groups: "tag_groups",
  } as const;

  for (const [name, collection] of Object.entries(expectedCollections)) {
    const config = tools[name].config;
    assert.deepEqual(Object.keys(config.inputSchema), []);
    assert.deepEqual(Object.keys(config.outputSchema).sort(), [collection, "meta"].sort());
    assert.deepEqual(config.annotations, {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });
  }
});

test("group directory fetches every page and deduplicates by ID", async () => {
  const tools = await registeredDirectoryTools();
  const originalFetch = globalThis.fetch;
  const pages: number[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    assert.equal(url.pathname, "/groups.json");
    const page = Number(url.searchParams.get("page"));
    pages.push(page);

    if (page === 0) {
      return jsonResponse({
        groups: [
          { id: 1, name: "alpha", user_count: 8 },
          { id: 2, name: "beta", automatic: false },
        ],
        total_rows_groups: 3,
      });
    }
    if (page === 1) {
      return jsonResponse({
        groups: [
          { id: 2, name: "beta", automatic: false },
          { id: 3, name: "gamma", visibility_level: 1 },
        ],
        total_rows_groups: 3,
      });
    }
    return jsonResponse({ groups: [], total_rows_groups: 3 });
  }) as typeof fetch;

  try {
    const result = await tools.discourse_list_groups.handler({}, {});
    assertLeanDirectoryResult(result, "groups", 3);
    assert.deepEqual(
      (result.structuredContent?.groups as Array<{ id: number }>).map(({ id }) => id),
      [1, 2, 3]
    );
    assert.deepEqual(pages, [0, 1]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("group directory stops when a server repeats the same page", async () => {
  const tools = await registeredDirectoryTools();
  const originalFetch = globalThis.fetch;
  let requests = 0;

  // Simulate a server that ignores the page parameter and reports a total
  // larger than what it ever returns.
  globalThis.fetch = (async () => {
    requests++;
    return jsonResponse({
      groups: [
        { id: 1, name: "alpha" },
        { id: 2, name: "beta" },
      ],
      total_rows_groups: 10,
    });
  }) as typeof fetch;

  try {
    const result = await tools.discourse_list_groups.handler({}, {});
    assertLeanDirectoryResult(result, "groups", 2);
    assert.equal(requests, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("category directory stays complete when site.json categories are lazy-loaded", async () => {
  const tools = await registeredDirectoryTools();
  const originalFetch = globalThis.fetch;
  const requestedPages: number[] = [];
  const firstPage = Array.from({ length: 25 }, (_, index) => ({
    id: index + 1,
    name: `Category ${index + 1}`,
    slug: `category-${index + 1}`,
  }));

  globalThis.fetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit
  ) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    assert.equal(url.pathname, "/categories/search.json");
    assert.equal(init?.method, "POST");
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    const page = Number(body.page);
    requestedPages.push(page);
    assert.equal(body.include_subcategories, true);
    assert.equal(body.limit, 25);

    if (page === 1) {
      return jsonResponse({ categories: firstPage, categories_count: 27 });
    }
    if (page === 2) {
      // 26 and 27 form a three-level chain under category 1 (1 -> 26 -> 27),
      // as produced by sites with max_category_nesting = 3.
      return jsonResponse({
        categories: [
          { id: 25, name: "Category 25", slug: "category-25" },
          { id: 26, name: "Category 26", slug: "category-26", parent_category_id: 1 },
          { id: 27, name: "Category 27", slug: "category-27", parent_category_id: 26 },
        ],
        categories_count: 27,
      });
    }
    return jsonResponse({ categories: [], categories_count: 27 });
  }) as typeof fetch;

  try {
    const result = await tools.discourse_list_categories.handler({}, {});
    assertLeanDirectoryResult(result, "categories", 27);
    assert.deepEqual(requestedPages, [1, 2]);

    const byId = new Map(
      (result.structuredContent?.categories as Array<{ id: number; parent_category_id: number | null }>)
        .map((c) => [c.id, c.parent_category_id])
    );
    assert.equal(byId.get(1), null);
    assert.equal(byId.get(26), 1);
    assert.equal(byId.get(27), 26);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("tag-group directory returns lean structured content", async () => {
  const tools = await registeredDirectoryTools();
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () =>
    jsonResponse({
      tag_groups: [
        { id: 4, name: "places", tags: ["paris"] },
        { id: 4, name: "places", tags: ["paris", "rome"] },
        { id: 7, name: "priorities", one_per_topic: true },
      ],
    })) as typeof fetch;

  try {
    const result = await tools.discourse_list_tag_groups.handler({}, {});
    assertLeanDirectoryResult(result, "tag_groups", 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("tag-group staff authorization failures are explicit tool errors", async () => {
  const tools = await registeredDirectoryTools();
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () =>
    jsonResponse({ errors: ["You are not permitted to view the requested resource."] }, 403)) as typeof fetch;

  try {
    const result = await tools.discourse_list_tag_groups.handler({}, {});
    assert.equal(result.isError, true);
    assert.deepEqual(result.structuredContent, {
      error: "Listing tag groups requires an authenticated Discourse staff account.",
      code: "staff_access_required",
      status: 403,
    });
    assert.deepEqual(parsedText(result), result.structuredContent);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
