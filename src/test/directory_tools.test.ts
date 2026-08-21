import test from "node:test";
import assert from "node:assert/strict";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { HttpError } from "../http/client.js";
import { fetchAllCategories, fetchAllGroups } from "../site/directories.js";
import { Logger } from "../util/logger.js";
import { SiteState } from "../site/state.js";
import { listCategoriesTool } from "../tools/builtin/administration/list_categories.js";
import { listGroupsTool } from "../tools/builtin/groups/crud.js";
import { registerToolDefinitions } from "../tools/definition.js";
import { registerAllResources, type ResourceRegistrar } from "../resources/registry.js";

function category(id: number, parent: number | null = null) {
  return { id, name: `Category ${id}`, slug: `category-${id}`, parent_category_id: parent, topic_count: id, post_count: id * 2 };
}

function group(id: number) {
  return { id, name: `group-${id}`, user_count: id, custom_fields: { retained: true } };
}

function fakeClient(methods: Partial<Record<"get" | "getCached" | "post", (...args: any[]) => Promise<any>>>) {
  return {
    get: methods.get ?? (async () => { throw new Error("unexpected GET"); }),
    getCached: methods.getCached ?? (async () => { throw new Error("unexpected cached GET"); }),
    post: methods.post ?? (async () => { throw new Error("unexpected POST"); }),
  } as any;
}

function assertStructured(result: any) {
  assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
}

test("category fetcher starts at page 1, uses verified limit, deduplicates, and preserves deep hierarchy", async () => {
  const bodies: any[] = [];
  const client = fakeClient({
    post: async (_path, body) => {
      bodies.push(body);
      if (body.page === 1) return { categories_count: 3, categories: [category(1), category(2, 1)] };
      return { categories_count: 3, categories: [category(2, 1), category(3, 2)] };
    },
  });
  const result = await fetchAllCategories(client, { authenticated: true, request_interval_ms: 0, cache_ttl_ms: 0 });
  assert.deepEqual(bodies.map((body) => body.page), [1, 2]);
  assert.ok(bodies.every((body) => body.limit === 25 && body.include_subcategories === true));
  assert.deepEqual(result.categories.map((item) => item.id), [1, 2, 3]);
  assert.equal(result.categories[2].parent_category_id, 2);
  assert.equal(result.categories[2].pid, 2);
  assert.deepEqual(result.meta, { total: 3, reported_total: 3, pages_fetched: 2, complete: true, has_more: false });
});

test("category fetcher serializes term/bounds and labels every safety termination truthfully", async () => {
  const requestBodies: any[] = [];
  const pageLimited = await fetchAllCategories(fakeClient({ post: async (_path, body) => {
    requestBodies.push(body);
    return { categories: [category(body.page)] };
  } }), { authenticated: true, term: "support", max_pages: 1, request_interval_ms: 0, cache_ttl_ms: 0 });
  assert.equal(requestBodies[0].term, "support");
  assert.equal(pageLimited.meta.truncated_reason, "page_limit");
  assert.equal(pageLimited.meta.complete, false);

  const repeated = await fetchAllCategories(fakeClient({ post: async () => ({ categories_count: 5, categories: [category(1)] }) }), {
    authenticated: true, request_interval_ms: 0, cache_ttl_ms: 0,
  });
  assert.equal(repeated.meta.truncated_reason, "no_new_ids");

  let mismatchPage = 0;
  const mismatch = await fetchAllCategories(fakeClient({ post: async () => (++mismatchPage === 1
    ? { categories_count: 3, categories: [category(1)] }
    : { categories_count: 3, categories: [] }) }), { authenticated: true, request_interval_ms: 0, cache_ttl_ms: 0 });
  assert.equal(mismatch.meta.truncated_reason, "total_mismatch");
  assert.equal(mismatch.meta.complete, false);

  const deadlineStarted = Date.now();
  const delayed = await fetchAllCategories(fakeClient({ post: async (_path, _body, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(new DOMException("deadline", "AbortError")), { once: true });
  }) }), { authenticated: true, deadline_ms: 5, request_interval_ms: 0, cache_ttl_ms: 0 });
  assert.equal(delayed.meta.truncated_reason, "deadline");
  assert.ok(Date.now() - deadlineStarted < 100);

  const controller = new AbortController();
  const cancelled = await fetchAllCategories(fakeClient({ post: async () => {
    controller.abort();
    return { categories: [category(1)] };
  } }), { authenticated: true, signal: controller.signal, request_interval_ms: 0, cache_ttl_ms: 0 });
  assert.equal(cancelled.meta.truncated_reason, "cancelled");
});

test("category endpoint fallbacks are narrow, incomplete, and cache-isolated by client/options", async () => {
  const paths: string[] = [];
  const client = fakeClient({
    post: async () => { throw new HttpError(404, "missing"); },
    get: async (path) => { paths.push(path); throw new HttpError(404, "missing"); },
    getCached: async () => ({ categories: [category(9)] }),
  });
  const legacy = await fetchAllCategories(client, { authenticated: true, request_interval_ms: 0 });
  assert.equal(legacy.meta.truncated_reason, "legacy_site_json");
  assert.equal(legacy.meta.complete, false);
  const cached = await fetchAllCategories(client, { authenticated: true, request_interval_ms: 0 });
  assert.equal(cached, legacy);
  assert.ok(paths[0].includes("page=1"));

  const anonymous = await fetchAllCategories(fakeClient({
    post: async () => { throw new HttpError(403, "anonymous csrf"); },
    get: async () => { throw new HttpError(403, "access"); },
    getCached: async () => ({ categories: [category(10)] }),
  }), { authenticated: false, request_interval_ms: 0, cache_ttl_ms: 0 });
  assert.equal(anonymous.meta.truncated_reason, "anonymous_fallback");

  await assert.rejects(
    fetchAllCategories(fakeClient({ post: async () => { throw new HttpError(429, "limited"); } }), { authenticated: true, request_interval_ms: 0, cache_ttl_ms: 0 }),
    /limited/,
  );
});

test("anonymous category POST rejection traverses nested GET fallback pages without claiming completeness or ignoring term", async () => {
  const paths: string[] = [];
  const client = fakeClient({
    post: async () => { throw new HttpError(403, "csrf"); },
    get: async (path) => {
      paths.push(path);
      if (paths.length > 1) return { category_list: { categories: [] } };
      return { category_list: { categories: [
        { ...category(1), name: "Root", subcategory_list: [
          { ...category(2, 1), name: "Support", subcategory_list: [
            { ...category(3, 2), name: "Support Deep" },
          ] },
          { ...category(4, 1), name: "Unrelated" },
        ] },
      ] } };
    },
  });
  const result = await fetchAllCategories(client, {
    authenticated: false,
    term: "support",
    request_interval_ms: 0,
    cache_ttl_ms: 0,
  });
  assert.equal(paths.length, 2);
  assert.match(paths[0], /page=1/);
  assert.match(paths[1], /page=2/);
  assert.doesNotMatch(paths[0], /term=/);
  assert.deepEqual(result.categories.map((item) => item.id), [2, 3]);
  assert.equal(result.meta.complete, false);
  assert.equal(result.meta.truncated_reason, "anonymous_fallback");
});

test("category request budget includes endpoint switching and fallback requests", async () => {
  let requests = 0;
  const result = await fetchAllCategories(fakeClient({
    post: async () => { requests++; throw new HttpError(403, "csrf"); },
    get: async () => { requests++; return { category_list: { categories: [category(1)] } }; },
  }), { authenticated: false, max_requests: 1, request_interval_ms: 0, cache_ttl_ms: 0 });
  assert.equal(requests, 1);
  assert.equal(result.meta.truncated_reason, "page_limit");
  assert.equal(result.meta.complete, false);
});

test("malformed directory wrappers cannot masquerade as complete empty sites", async () => {
  const categories = await fetchAllCategories(fakeClient({ post: async () => ({ unexpected: [] }) }), {
    authenticated: true, request_interval_ms: 0, cache_ttl_ms: 0,
  });
  assert.equal(categories.meta.complete, false);
  assert.equal(categories.meta.truncated_reason, "upstream_error");
  assert.match(categories.meta.error!, /Malformed category directory wrapper/);

  const groups = await fetchAllGroups(fakeClient({ get: async () => ({ unexpected: [] }) }), {
    request_interval_ms: 0, cache_ttl_ms: 0,
  });
  assert.equal(groups.meta.complete, false);
  assert.equal(groups.meta.truncated_reason, "upstream_error");
  assert.match(groups.meta.error!, /Malformed group directory wrapper/);
});

test("malformed category records terminate safely without claiming completion", async () => {
  const result = await fetchAllCategories(fakeClient({ post: async () => ({ categories_count: 2, categories: [category(1), { id: "bad" }] }) }), {
    authenticated: true, request_interval_ms: 0, cache_ttl_ms: 0,
  });
  assert.equal(result.meta.complete, false);
  assert.equal(result.meta.truncated_reason, "upstream_error");
  assert.match(result.meta.error!, /Malformed/);
});

test("later-page directory failures preserve accumulated data with bounded error context", async () => {
  let categoryPage = 0;
  const categories = await fetchAllCategories(fakeClient({ post: async () => {
    categoryPage++;
    if (categoryPage === 1) return { categories: [category(1)] };
    throw new HttpError(500, "later category failure", { secret: "must not leak" });
  } }), { authenticated: true, request_interval_ms: 0, cache_ttl_ms: 0 });
  assert.deepEqual(categories.categories.map((item) => item.id), [1]);
  assert.equal(categories.meta.truncated_reason, "upstream_error");
  assert.doesNotMatch(categories.meta.error!, /secret/);

  let groupPage = 0;
  const groups = await fetchAllGroups(fakeClient({ get: async () => {
    groupPage++;
    if (groupPage === 1) return { groups: [group(1)] };
    throw new HttpError(500, "later group failure", { secret: "must not leak" });
  } }), { request_interval_ms: 0, cache_ttl_ms: 0 });
  assert.deepEqual(groups.groups.map((item) => item.id), [1]);
  assert.equal(groups.meta.truncated_reason, "upstream_error");
  assert.doesNotMatch(groups.meta.error!, /secret/);
});

test("group fetcher starts at page 0, preserves rich fields, deduplicates, and reaches authoritative total", async () => {
  const paths: string[] = [];
  const client = fakeClient({ get: async (path) => {
    paths.push(path);
    return paths.length === 1
      ? { groups: [group(1), group(2)], total_rows_groups: 3, load_more_groups: "/groups?page=1", extras: { type_filters: ["public"] } }
      : { groups: [group(2), group(3)], total_rows_groups: 3, load_more_groups: "/groups?page=2" };
  } });
  const result = await fetchAllGroups(client, { request_interval_ms: 0, cache_ttl_ms: 0 });
  assert.deepEqual(paths, ["/groups.json?page=0", "/groups.json?page=1"]);
  assert.deepEqual(result.groups.map((item) => item.id), [1, 2, 3]);
  assert.deepEqual(result.groups[0].custom_fields, { retained: true });
  assert.equal(result.meta.complete, true);
  assert.deepEqual(result.extras, { type_filters: ["public"] });
});

test("group fetcher marks no-total traversal complete only after an empty page", async () => {
  let page = 0;
  const result = await fetchAllGroups(fakeClient({ get: async () => (++page === 1 ? { groups: [group(1)] } : { groups: [] }) }), {
    request_interval_ms: 0, cache_ttl_ms: 0,
  });
  assert.equal(result.meta.complete, true);
  assert.equal(result.meta.reported_total, null);
  assert.equal(result.meta.pages_fetched, 2);
});

test("group fetcher never calls repeats complete and reports empty mismatch, deadline, cancellation, and budget", async () => {
  const repeated = await fetchAllGroups(fakeClient({ get: async () => ({ groups: [group(1)], total_rows_groups: 5, load_more_groups: "/groups?page=next" }) }), {
    request_interval_ms: 0, cache_ttl_ms: 0,
  });
  assert.equal(repeated.meta.truncated_reason, "no_new_ids");
  assert.equal(repeated.meta.complete, false);

  let page = 0;
  const mismatch = await fetchAllGroups(fakeClient({ get: async () => (++page === 1
    ? { groups: [group(1)], total_rows_groups: 2 }
    : { groups: [], total_rows_groups: 2 }) }), { request_interval_ms: 0, cache_ttl_ms: 0 });
  assert.equal(mismatch.meta.truncated_reason, "total_mismatch");

  const limited = await fetchAllGroups(fakeClient({ get: async () => ({ groups: [group(1)] }) }), {
    max_pages: 1, request_interval_ms: 0, cache_ttl_ms: 0,
  });
  assert.equal(limited.meta.truncated_reason, "page_limit");

  const requestBudget = await fetchAllGroups(fakeClient({ get: async () => ({ groups: [group(1)] }) }), {
    max_pages: 40, max_requests: 1, request_interval_ms: 0, cache_ttl_ms: 0,
  });
  assert.equal(requestBudget.meta.truncated_reason, "page_limit");
  assert.equal(requestBudget.meta.pages_fetched, 1);

  const groupDeadlineStarted = Date.now();
  const delayed = await fetchAllGroups(fakeClient({ get: async (_path, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(new DOMException("deadline", "AbortError")), { once: true });
  }) }), { deadline_ms: 5, request_interval_ms: 0, cache_ttl_ms: 0 });
  assert.equal(delayed.meta.truncated_reason, "deadline");
  assert.ok(Date.now() - groupDeadlineStarted < 100);

  const controller = new AbortController();
  const cancelled = await fetchAllGroups(fakeClient({ get: async () => {
    controller.abort();
    return { groups: [group(1)] };
  } }), { signal: controller.signal, request_interval_ms: 0, cache_ttl_ms: 0 });
  assert.equal(cancelled.meta.truncated_reason, "cancelled");
});

test("directory tools distinguish exhaustive and explicit group modes, reject unknown keys, and return structured output", async () => {
  const logger = new Logger("silent");
  const siteState = new SiteState({ logger, timeoutMs: 5000, defaultAuth: { type: "api_key", key: "key", username: "admin" } });
  siteState.selectSite("https://example.com");
  const requests: Array<{ url: string; method: string; body?: any }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.endsWith("/categories/search.json")) return Response.json({ categories_count: 1, categories: [category(1)] });
    if (url.includes("/groups.json?page=0")) return Response.json({ groups: [group(1)], total_rows_groups: 1, load_more_groups: null });
    if (url.includes("/groups.json")) return Response.json({ groups: [group(2)], total_rows_groups: 10, load_more_groups: "/groups?page=1", extras: { retained: true } });
    return Response.json({});
  };

  const server = new McpServer({ name: "directory-test", version: "1" });
  const client = new Client({ name: "directory-client", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  registerToolDefinitions([listCategoriesTool, listGroupsTool], {
    server,
    siteState,
    logger,
    maxReadLength: 1000,
  }, {
    allowWrites: false,
    toolsMode: "discourse_api_only",
    toolsets: ["administration", "groups"],
  });

  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const advertised = await client.listTools();
    for (const name of ["discourse_list_categories", "discourse_list_groups"]) {
      assert.ok(advertised.tools.find((tool) => tool.name === name)?.outputSchema);
    }
    const categories = await client.callTool({ name: "discourse_list_categories", arguments: {} });
    assertStructured(categories);
    const exhaustive = await client.callTool({ name: "discourse_list_groups", arguments: {} });
    assertStructured(exhaustive);
    const explicitPage = await client.callTool({ name: "discourse_list_groups", arguments: { page: 0 } });
    assertStructured(explicitPage);
    const explicitFalse = await client.callTool({ name: "discourse_list_groups", arguments: { asc: false } });
    assertStructured(explicitFalse);
    assert.equal(requests.filter((request) => request.url.includes("groups.json?page=0")).length, 2);
    assert.ok(requests.some((request) => request.url.endsWith("/groups.json?asc=false")));

    const invalid = await client.callTool({ name: "discourse_list_groups", arguments: { surprise: true } });
    assert.equal(invalid.isError, true);
  } finally {
    globalThis.fetch = original;
    await client.close();
    await server.close();
  }
});

test("deprecated resources reuse complete fetchers and chunk category permission enrichment", async () => {
  const logger = new Logger("silent");
  const siteState = new SiteState({ logger, timeoutMs: 5000, defaultAuth: { type: "api_key", key: "key", username: "admin" } });
  siteState.selectSite("https://resources.example.com");
  const registrations: Record<string, unknown[]> = {};
  const server = {
    resource(name: string, ...args: unknown[]) { registrations[name] = args; },
  } as ResourceRegistrar;
  registerAllResources(server, { siteState, logger });

  const allCategories = Array.from({ length: 51 }, (_, index) => category(index + 1));
  const findRequests: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/categories/search.json")) {
      const page = JSON.parse(String(init?.body)).page as number;
      return Response.json({ categories_count: 51, categories: allCategories.slice((page - 1) * 25, page * 25) });
    }
    if (url.includes("/categories/find.json")) {
      findRequests.push(url);
      const ids = new URL(url).searchParams.getAll("ids[]").map(Number);
      return Response.json({ categories: allCategories.filter((item) => ids.includes(item.id)).map((item) => ({
        ...item, group_permissions: [{ group_id: 0, permission_type: 1 }],
      })) });
    }
    if (url.includes("/groups.json?page=0")) return Response.json({ groups: [group(1)], total_rows_groups: 1 });
    return Response.json({});
  };
  try {
    const categoryCallback = registrations.site_categories[2] as (uri: URL) => Promise<any>;
    const categoryResult = await categoryCallback(new URL("discourse://site/categories"));
    const categoryBody = JSON.parse(categoryResult.contents[0].text);
    assert.equal(categoryBody.categories.length, 51);
    assert.equal(categoryBody.meta.complete, true);
    assert.deepEqual(categoryBody.categories[0].perms, [{ gid: 0, perm: 1 }]);
    assert.equal(findRequests.length, 2);
    assert.equal(new URL(findRequests[0]).searchParams.getAll("ids[]").length, 50);

    const groupCallback = registrations.site_groups[2] as (uri: URL) => Promise<any>;
    const groupResult = await groupCallback(new URL("discourse://site/groups"));
    const groupBody = JSON.parse(groupResult.contents[0].text);
    assert.equal(groupBody.groups.length, 1);
    assert.equal(groupBody.meta.complete, true);
  } finally {
    globalThis.fetch = original;
  }
});

test("deprecated group resource reports upstream errors instead of a truthful empty directory", async () => {
  const logger = new Logger("silent");
  const siteState = new SiteState({ logger, timeoutMs: 5000, defaultAuth: { type: "none" } });
  siteState.selectSite("https://resource-error.example.com");
  const registrations: Record<string, unknown[]> = {};
  registerAllResources({ resource(name: string, ...args: unknown[]) { registrations[name] = args; } } as ResourceRegistrar, { siteState, logger });
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ error: "bad" }, { status: 400 });
  try {
    const callback = registrations.site_groups[2] as (uri: URL) => Promise<any>;
    const result = await callback(new URL("discourse://site/groups"));
    const parsed = JSON.parse(result.contents[0].text);
    assert.equal(parsed.code, "upstream_error");
    assert.equal(parsed.groups, undefined);
  } finally {
    globalThis.fetch = original;
  }
});

test("malformed group data is a normal unstructured tool error", async () => {
  const logger = new Logger("silent");
  const siteState = new SiteState({ logger, timeoutMs: 5000, defaultAuth: { type: "none" } });
  siteState.selectSite("https://malformed-groups.example.com");
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ groups: [{ id: "wrong", name: "Broken" }], total_rows_groups: 1 });
  try {
    const result = await listGroupsTool.handler({} as any, {} as any, { server: {} as any, siteState, logger, maxReadLength: 1000 }, { allowWrites: false, toolsMode: "discourse_api_only" });
    assert.equal(result.isError, true);
    assert.equal((result as any).structuredContent, undefined);
  } finally {
    globalThis.fetch = original;
  }
});

test("representative 300-category projection remains bounded near the documented measurement", () => {
  const categories = Array.from({ length: 300 }, (_, index) => ({
    ...category(index + 1, index % 3 === 0 ? null : Math.max(1, index)),
    pid: index % 3 === 0 ? null : Math.max(1, index),
    read_restricted: false,
  }));
  const bytes = Buffer.byteLength(JSON.stringify({
    categories,
    meta: { total: 300, reported_total: 300, pages_fetched: 12, complete: true, has_more: false },
  }));
  assert.ok(bytes >= 40_000 && bytes <= 55_000, `unexpected projection size ${bytes}`);
});

test("malformed directory data is a normal MCP tool error rather than output validation failure", async () => {
  const logger = new Logger("silent");
  const siteState = new SiteState({ logger, timeoutMs: 5000, defaultAuth: { type: "api_key", key: "key", username: "admin" } });
  siteState.selectSite("https://malformed.example.com");
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ categories_count: 1, categories: [{ id: "wrong" }] });
  const result = await listCategoriesTool.handler({} as any, {} as any, { server: {} as any, siteState, logger, maxReadLength: 1000 }, { allowWrites: false, toolsMode: "discourse_api_only" });
  try {
    assert.equal(result.isError, true);
    assert.equal((result as any).structuredContent, undefined);
  } finally {
    globalThis.fetch = original;
  }
});
