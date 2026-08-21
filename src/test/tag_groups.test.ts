import test from "node:test";
import assert from "node:assert/strict";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Logger } from "../util/logger.js";
import { HttpError } from "../http/client.js";
import { SiteState } from "../site/state.js";
import type { ToolContext, ToolRegistrationOptions } from "../tools/types.js";
import { registerToolDefinitions } from "../tools/definition.js";
import { tagGroupTools } from "../tools/builtin/tag_groups/index.js";
import { normalizeTagGroup, tagGroupError, tagGroupStateHash } from "../tools/builtin/tag_groups/common.js";

const tags = [
  { id: 1, name: "alpha", slug: "alpha" },
  { id: 2, name: "beta", slug: "beta" },
  { id: 3, name: "parent", slug: "parent" },
];

function rawGroup(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    name: "Editorial",
    tags: [tags[0]],
    parent_tag: [],
    one_per_topic: false,
    permissions: { "0": 1 },
    ...overrides,
  };
}

let siteCounter = 0;
function harness(authenticated = true, allowWrites = true) {
  const logger = new Logger("silent");
  const siteState = new SiteState({
    logger,
    timeoutMs: 5000,
    defaultAuth: authenticated ? { type: "api_key", key: "key", username: "admin" } : { type: "none" },
  });
  siteState.selectSite(`https://tag-groups-${++siteCounter}.example.com`);
  const ctx: ToolContext = { server: {} as any, siteState, logger, maxReadLength: 1000 };
  const opts: ToolRegistrationOptions = { allowWrites, toolsMode: "discourse_api_only", toolsets: ["tag_groups"] };
  return {
    ctx,
    opts,
    async invoke(name: string, input: Record<string, unknown>) {
      const tool = tagGroupTools.find((candidate) => candidate.name === name);
      assert.ok(tool, `missing ${name}`);
      return tool.handler(input as any, {} as any, ctx, opts);
    },
  };
}

function body(result: any) {
  return JSON.parse(result.content[0].text);
}

function assertStructured(result: any) {
  assert.deepEqual(body(result), result.structuredContent);
}

function mockFetch(responder: (request: Request, index: number) => Response | Promise<Response>) {
  const original = globalThis.fetch;
  const requests: Request[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    requests.push(request);
    return responder(request, requests.length - 1);
  }) as any;
  return { requests, restore: () => { globalThis.fetch = original; } };
}

test("tag-group catalog is exactly six opt-in tools with accurate availability, annotations, and output schemas", () => {
  assert.deepEqual(tagGroupTools.map((tool) => tool.name), [
    "discourse_search_tag_groups",
    "discourse_list_tag_groups",
    "discourse_get_tag_group",
    "discourse_create_tag_group",
    "discourse_update_tag_group",
    "discourse_delete_tag_group",
  ]);
  tagGroupTools.forEach((tool, index) => {
    assert.deepEqual(tool.toolsets, ["tag_groups"]);
    assert.ok(tool.outputSchema);
    assert.equal(tool.availability, index < 3 ? "always" : "writes_enabled");
    assert.equal(tool.annotations?.readOnlyHint, index < 3);
  });
  assert.equal(tagGroupTools[3].annotations?.destructiveHint, false);
  assert.equal(tagGroupTools[4].annotations?.destructiveHint, true);
  assert.equal(tagGroupTools[5].annotations?.destructiveHint, true);
  assert.equal(tagGroupTools[3].annotations?.idempotentHint, false);
  assert.equal(tagGroupTools[5].annotations?.idempotentHint, false);
  assert.match(tagGroupTools[0].description, /% and _.*wildcards/);
});

test("public search always sends limit and names arrays, combines q, shapes visibility-safe data, and reports possible truncation", async () => {
  const mock = mockFetch((request) => {
    const url = new URL(request.url);
    assert.equal(url.pathname, "/tag_groups/filter/search.json");
    assert.equal(url.searchParams.get("q"), "edit%");
    assert.deepEqual(url.searchParams.getAll("names[]"), ["Editorial", "Review"]);
    assert.equal(url.searchParams.get("limit"), "2");
    return Response.json({ results: [
      { name: "Editorial", tags: [tags[0]], id: 999, permissions: { secret: true } },
      { name: "Review", tags: [tags[1]] },
    ] });
  });
  try {
    const result = await harness(false, false).invoke("discourse_search_tag_groups", {
      q: "edit%", names: ["Editorial", "Review"], limit: 2,
    });
    assertStructured(result);
    assert.deepEqual(body(result).results[0], { name: "Editorial", tags: [tags[0]] });
    assert.deepEqual(body(result).meta, { limit: 2, returned: 2, truncated: true });
  } finally { mock.restore(); }
});

test("public search defaults limit to 100 and keeps a single name as names[]", async () => {
  const mock = mockFetch((request) => {
    const url = new URL(request.url);
    assert.deepEqual(url.searchParams.getAll("names[]"), ["Editorial"]);
    assert.equal(url.searchParams.get("limit"), "100");
    return Response.json({ results: [] });
  });
  try {
    const result = await harness(false, false).invoke("discourse_search_tag_groups", { names: ["Editorial"] });
    assertStructured(result);
    assert.deepEqual(body(result).meta, { limit: 100, returned: 0, truncated: false });
  } finally { mock.restore(); }
});

test("staff list/get normalize exact wrappers, permissions and parent shape with deterministic hashes", async () => {
  const fixture = rawGroup({ parent_tag: [tags[2]], tags: [tags[1], tags[0]], permissions: { "9": 3, "0": 1 } });
  const mock = mockFetch((request) => request.url.endsWith("/tag_groups.json")
    ? Response.json({ tag_groups: [rawGroup({ id: 8, name: "Zed" }), fixture] })
    : Response.json({ tag_group: fixture }));
  try {
    const api = harness();
    const listed = await api.invoke("discourse_list_tag_groups", {});
    assertStructured(listed);
    assert.deepEqual(body(listed).tag_groups.map((group: any) => group.name), ["Editorial", "Zed"]);
    const normalized = body(listed).tag_groups[0];
    assert.deepEqual(normalized.parent_tag, tags[2]);
    assert.deepEqual(normalized.permissions, { "0": 1, "9": 3 });
    assert.equal(normalized.state_hash, tagGroupStateHash(normalized));

    const detail = await api.invoke("discourse_get_tag_group", { id: 7 });
    assertStructured(detail);
    assert.equal(body(detail).tag_group.state_hash, normalizeTagGroup(fixture).state_hash);
  } finally { mock.restore(); }
});

test("staff reads and writes reject missing local credentials/write mode before HTTP", async () => {
  const mock = mockFetch(() => Response.json({}));
  try {
    const anonymous = harness(false, true);
    assert.equal((await anonymous.invoke("discourse_list_tag_groups", {})).isError, true);
    const readOnly = harness(true, false);
    assert.equal((await readOnly.invoke("discourse_create_tag_group", {
      name: "New", tags: [{ id: 1 }], permissions: { "0": 1 }, allow_tag_creation: false,
    })).isError, true);
    assert.equal(mock.requests.length, 0);
  } finally { mock.restore(); }
});

test("create preflights duplicates and IDs, requires tag-creation confirmation, and emits one strict modern wrapper", async () => {
  const mock = mockFetch(async (request) => {
    if (request.url.endsWith("/tag_groups.json") && request.method === "GET") return Response.json({ tag_groups: [] });
    if (request.url.endsWith("/tags.json")) return Response.json({ tags });
    if (request.url.endsWith("/tag_groups.json") && request.method === "POST") {
      const payload = await request.json() as any;
      assert.deepEqual(payload, { tag_group: {
        name: "New Group",
        tags: [{ id: 1 }, { name: "brand-new" }],
        parent_tag: [{ id: 3 }],
        one_per_topic: true,
        permissions: { "0": 1 },
      } });
      assert.equal((payload.tag_group as any).id, undefined);
      assert.equal(typeof payload.tag_group.permissions["0"], "number");
      return Response.json({ tag_group: rawGroup({ id: 10, name: "New Group", tags: [tags[0], { id: 10, name: "brand-new", slug: "brand-new" }], parent_tag: [tags[2]], one_per_topic: true }) });
    }
    return Response.json({});
  });
  try {
    const result = await harness().invoke("discourse_create_tag_group", {
      name: " New Group ",
      tags: [{ id: 1 }, { name: "brand-new" }],
      parent_tag: { id: 3 },
      one_per_topic: true,
      permissions: { "0": 1 },
      allow_tag_creation: true,
    });
    assertStructured(result);
    assert.equal(body(result).tag_group.name, "New Group");
    assert.equal(mock.requests.filter((request) => request.method === "POST").length, 1);
  } finally { mock.restore(); }

  const noCreation = mockFetch((request) => request.url.endsWith("/tag_groups.json")
    ? Response.json({ tag_groups: [] })
    : Response.json({ tags }));
  try {
    const result = await harness().invoke("discourse_create_tag_group", {
      name: "Blocked", tags: [{ name: "unknown" }], permissions: { "0": 1 }, allow_tag_creation: false,
    });
    assert.equal(result.isError, true);
    assert.match(body(result).error, /allow_tag_creation/);
    assert.equal(noCreation.requests.some((request) => request.method === "POST"), false);
  } finally { noCreation.restore(); }
});

test("writes authoritatively resolve valid tag IDs omitted from the general tag inventory", async () => {
  const mock = mockFetch(async (request) => {
    if (request.url.endsWith("/tag_groups.json") && request.method === "GET") return Response.json({ tag_groups: [] });
    if (request.url.endsWith("/tags.json")) return Response.json({ tags: [] });
    if (request.url.endsWith("/tag/42/info.json")) return Response.json({ tag_info: { id: 42, name: "unused-visible" } });
    if (request.method === "POST") {
      const payload = await request.json() as any;
      assert.deepEqual(payload.tag_group.tags, [{ id: 42 }]);
      return Response.json({ tag_group: rawGroup({ id: 12, name: "Unused", tags: [{ id: 42, name: "unused-visible", slug: "unused-visible" }] }) });
    }
    return Response.json({});
  });
  try {
    const result = await harness().invoke("discourse_create_tag_group", {
      name: "Unused", tags: [{ id: 42 }], permissions: { "0": 1 }, allow_tag_creation: false,
    });
    assertStructured(result);
    assert.ok(mock.requests.some((request) => request.url.endsWith("/tag/42/info.json")));
  } finally { mock.restore(); }
});

test("create rejects case-insensitive duplicate names, unknown IDs, parent/member conflicts, and invalid permission policy", async () => {
  const duplicate = mockFetch((request) => request.url.endsWith("/tag_groups.json")
    ? Response.json({ tag_groups: [rawGroup()] })
    : Response.json({ tags }));
  try {
    const result = await harness().invoke("discourse_create_tag_group", {
      name: "editorial", tags: [{ id: 1 }], permissions: { "0": 1 }, allow_tag_creation: false,
    });
    assert.equal(body(result).code, "duplicate_name");
  } finally { duplicate.restore(); }

  const ids = mockFetch((request) => request.url.endsWith("/tag_groups.json")
    ? Response.json({ tag_groups: [] })
    : Response.json({ tags }));
  try {
    const api = harness();
    const unknown = await api.invoke("discourse_create_tag_group", {
      name: "Unknown", tags: [{ id: 999 }], permissions: { "0": 1 }, allow_tag_creation: false,
    });
    assert.equal(unknown.isError, true);
    const conflict = await api.invoke("discourse_create_tag_group", {
      name: "Conflict", tags: [{ id: 1 }], parent_tag: { id: 1 }, permissions: { "0": 1 }, allow_tag_creation: false,
    });
    assert.equal(conflict.isError, true);
    assert.equal(ids.requests.some((request) => request.method === "POST"), false);
  } finally { ids.restore(); }

  const groups = mockFetch((request) => {
    if (request.url.endsWith("/tag_groups.json")) return Response.json({ tag_groups: [] });
    if (request.url.endsWith("/tags.json")) return Response.json({ tags });
    if (request.url.includes("/groups.json?page=0")) return Response.json({ groups: [], total_rows_groups: 0 });
    return Response.json({});
  });
  try {
    const unknownGroup = await harness().invoke("discourse_create_tag_group", {
      name: "Unknown group", tags: [{ id: 1 }], permissions: { "99": 1 }, allow_tag_creation: false,
    });
    assert.equal(unknownGroup.isError, true);
    assert.match(body(unknownGroup).error, /permission group IDs: 99/);
    assert.equal(groups.requests.some((request) => request.method === "POST"), false);
  } finally { groups.restore(); }

  const createSchema = tagGroupTools.find((tool) => tool.name === "discourse_create_tag_group")!.schema;
  assert.equal(createSchema.safeParse({ name: "Bad", tags: [{ id: 1, name: "both" }], permissions: { "0": 1 } }).success, false);
  assert.equal(createSchema.safeParse({ name: "Bad", tags: [{ id: 1 }], permissions: { "0": 2 } }).success, false);
  assert.equal(createSchema.safeParse({ name: "Bad", tags: [{ id: 1 }], permissions: {} }).success, false);
  assert.equal(createSchema.safeParse({ name: "Bad", tags: [{ id: 1 }], permissions: { "01": 1 } }).success, false);
  assert.equal(createSchema.safeParse({ name: "Bad", tags: [{ id: 1 }], permissions: { "0": 1 }, id: 9 }).success, false);
});

test("update performs fresh hash preflight, preserves omitted values, sends complete state, and verifies authoritative normalization", async () => {
  const current = rawGroup();
  const updated = rawGroup({ name: "Renamed", one_per_topic: true });
  let detailReads = 0;
  const mock = mockFetch(async (request) => {
    if (request.url.endsWith("/tag_groups/7.json") && request.method === "GET") {
      detailReads++;
      return Response.json({ tag_group: detailReads === 1 ? current : updated });
    }
    if (request.url.endsWith("/tag_groups.json")) return Response.json({ tag_groups: [current] });
    if (request.url.endsWith("/tags.json")) return Response.json({ tags });
    if (request.url.endsWith("/tag_groups/7.json") && request.method === "PUT") {
      const payload = await request.json() as any;
      assert.deepEqual(payload, { tag_group: {
        name: "Renamed",
        tags: [{ id: 1 }],
        parent_tag: [],
        one_per_topic: true,
        permissions: { "0": 1 },
      } });
      assert.equal((payload.tag_group as any).id, undefined);
      return Response.json({ success: "OK", tag_group: updated });
    }
    return Response.json({});
  });
  try {
    const result = await harness().invoke("discourse_update_tag_group", {
      id: 7,
      expected_state_hash: normalizeTagGroup(current).state_hash,
      name: "Renamed",
      one_per_topic: true,
      acknowledge_possible_synthetic_permission_materialization: true,
    });
    assertStructured(result);
    assert.equal(body(result).tag_group.name, "Renamed");
    assert.match(body(result).warnings[0], /materializes/);
    assert.equal(detailReads, 2);
  } finally { mock.restore(); }
});

test("update rejects hash conflicts, no-ops, removals and permission replacement without confirmations", async () => {
  const current = rawGroup({ tags: [tags[0], tags[1]] });
  const mock = mockFetch((request) => {
    if (request.url.endsWith("/tag_groups/7.json")) return Response.json({ tag_group: current });
    if (request.url.endsWith("/tags.json")) return Response.json({ tags });
    return Response.json({ tag_groups: [current] });
  });
  try {
    const api = harness();
    const conflict = await api.invoke("discourse_update_tag_group", { id: 7, expected_state_hash: "0".repeat(64), name: "X" });
    assert.equal(body(conflict).code, "state_conflict");
    const noOp = await api.invoke("discourse_update_tag_group", { id: 7, expected_state_hash: normalizeTagGroup(current).state_hash });
    assert.equal(body(noOp).code, "no_op");
    const semanticNoOp = await api.invoke("discourse_update_tag_group", {
      id: 7,
      expected_state_hash: normalizeTagGroup(current).state_hash,
      name: "Editorial",
    });
    assert.equal(body(semanticNoOp).code, "no_op");
    const removal = await api.invoke("discourse_update_tag_group", {
      id: 7, expected_state_hash: normalizeTagGroup(current).state_hash, tags: [{ id: 1 }],
    });
    assert.equal(body(removal).code, "confirmation_required");
    const permissions = await api.invoke("discourse_update_tag_group", {
      id: 7, expected_state_hash: normalizeTagGroup(current).state_hash, permissions: { "0": 3 },
    });
    assert.equal(body(permissions).code, "confirmation_required");
    const synthetic = await api.invoke("discourse_update_tag_group", {
      id: 7, expected_state_hash: normalizeTagGroup(current).state_hash, one_per_topic: true,
    });
    assert.equal(body(synthetic).code, "confirmation_required");
    assert.match(body(synthetic).error, /serializer-synthesized/);
    assert.equal(mock.requests.some((request) => request.method === "PUT"), false);
  } finally { mock.restore(); }
});

test("update requires explicit confirmation before removing a parent relationship", async () => {
  const current = rawGroup({ parent_tag: [tags[2]] });
  const mock = mockFetch((request) => {
    if (request.url.endsWith("/tag_groups/7.json")) return Response.json({ tag_group: current });
    if (request.url.endsWith("/tags.json")) return Response.json({ tags });
    return Response.json({ tag_groups: [current] });
  });
  try {
    const result = await harness().invoke("discourse_update_tag_group", {
      id: 7,
      expected_state_hash: normalizeTagGroup(current).state_hash,
      parent_tag: null,
    });
    assert.equal(body(result).code, "confirmation_required");
    assert.match(body(result).error, /confirm_parent_removal/);
    assert.equal(mock.requests.some((request) => request.method === "PUT"), false);
  } finally { mock.restore(); }
});

test("update reports outcome_unknown without structured content when post-state cannot be read", async () => {
  const current = rawGroup();
  let gets = 0;
  const mock = mockFetch((request) => {
    if (request.url.endsWith("/tag_groups/7.json") && request.method === "GET") {
      gets++;
      return gets === 1 ? Response.json({ tag_group: current }) : new Response("down", { status: 500 });
    }
    if (request.url.endsWith("/tag_groups.json")) return Response.json({ tag_groups: [current] });
    if (request.url.endsWith("/tags.json")) return Response.json({ tags });
    if (request.method === "PUT") return Response.json({ success: "OK", tag_group: rawGroup({ name: "Renamed" }) });
    return Response.json({});
  });
  try {
    const result = await harness().invoke("discourse_update_tag_group", {
      id: 7, expected_state_hash: normalizeTagGroup(current).state_hash, name: "Renamed",
      acknowledge_possible_synthetic_permission_materialization: true,
    });
    assert.equal(result.isError, true);
    assert.equal(body(result).code, "outcome_unknown");
    assert.equal((result as any).structuredContent, undefined);
    assert.equal(mock.requests.filter((request) => request.method === "PUT").length, 1);
    assert.equal(mock.requests.filter((request) => request.method === "GET" && request.url.endsWith("/tag_groups/7.json")).length, 4); // retries on verification 5xx
  } finally { mock.restore(); }
});

test("delete rejects a mismatched detail ID before dispatch", async () => {
  const wrong = rawGroup({ id: 8 });
  const mock = mockFetch(() => Response.json({ tag_group: wrong }));
  try {
    const result = await harness().invoke("discourse_delete_tag_group", {
      id: 7,
      name: "Editorial",
      expected_state_hash: normalizeTagGroup(wrong).state_hash,
      confirm_delete: true,
      acknowledge_category_relationship_removal: true,
      acknowledge_unresolved_plugin_dependencies: true,
    });
    assert.equal(body(result).code, "identity_mismatch");
    assert.equal(mock.requests.some((request) => request.method === "DELETE"), false);
  } finally { mock.restore(); }
});

test("delete requires exact identity/acknowledgements, dispatches once without retry, and proves 404 absence", async () => {
  const current = rawGroup({ parent_tag: [tags[2]] });
  let gets = 0;
  const mock = mockFetch((request) => {
    if (request.url.endsWith("/tag_groups/7.json") && request.method === "GET") {
      gets++;
      return gets === 1 ? Response.json({ tag_group: current }) : Response.json({ error: "not found" }, { status: 404 });
    }
    if (request.method === "DELETE") return Response.json({ success: "OK" });
    return Response.json({});
  });
  try {
    const result = await harness().invoke("discourse_delete_tag_group", {
      id: 7,
      name: "Editorial",
      expected_state_hash: normalizeTagGroup(current).state_hash,
      confirm_delete: true,
      acknowledge_category_relationship_removal: true,
      acknowledge_unresolved_plugin_dependencies: true,
    });
    assertStructured(result);
    assert.equal(body(result).deleted, true);
    assert.equal(body(result).impact.dependency_discovery_exhaustive, false);
    assert.equal(body(result).impact.category_relationships.included, false);
    assert.equal(mock.requests.filter((request) => request.method === "DELETE").length, 1);
    assert.equal(mock.requests.some((request) => request.url.includes("categories")), false);
  } finally { mock.restore(); }

  const deleteSchema = tagGroupTools.find((tool) => tool.name === "discourse_delete_tag_group")!.schema;
  assert.equal(deleteSchema.safeParse({ id: 7, name: "Editorial", expected_state_hash: "a".repeat(64), confirm_delete: false, acknowledge_category_relationship_removal: true, acknowledge_unresolved_plugin_dependencies: true }).success, false);
});

test("delete returns unstructured outcome_unknown when absence cannot be proven", async () => {
  const current = rawGroup();
  const mock = mockFetch((request) => {
    if (request.method === "DELETE") return Response.json({ success: "OK" });
    return Response.json({ tag_group: current });
  });
  try {
    const result = await harness().invoke("discourse_delete_tag_group", {
      id: 7,
      name: "Editorial",
      expected_state_hash: normalizeTagGroup(current).state_hash,
      confirm_delete: true,
      acknowledge_category_relationship_removal: true,
      acknowledge_unresolved_plugin_dependencies: true,
    });
    assert.equal(result.isError, true);
    assert.equal(body(result).code, "outcome_unknown");
    assert.equal((result as any).structuredContent, undefined);
    assert.equal(mock.requests.filter((request) => request.method === "DELETE").length, 1);
  } finally { mock.restore(); }
});

test("tag-group mutations do not retry and diagnostics never leak arbitrary upstream bodies", async () => {
  const mock = mockFetch((request) => {
    if (request.url.endsWith("/tag_groups.json") && request.method === "GET") return Response.json({ tag_groups: [] });
    if (request.url.endsWith("/tags.json")) return Response.json({ tags });
    if (request.method === "POST") return Response.json({ errors: ["sensitive upstream detail"] }, { status: 500 });
    return Response.json({});
  });
  try {
    const result = await harness().invoke("discourse_create_tag_group", {
      name: "Failure", tags: [{ id: 1 }], permissions: { "0": 1 }, allow_tag_creation: false,
    });
    assert.equal(result.isError, true);
    assert.doesNotMatch(JSON.stringify(body(result)), /sensitive upstream detail/);
    assert.equal(mock.requests.filter((request) => request.method === "POST").length, 1);
  } finally { mock.restore(); }
});

test("shared tag-group diagnostics classify 401/403/404/422/429/5xx without leaking bodies", () => {
  const expected: Record<number, string> = {
    401: "authentication_required",
    403: "insufficient_permission_or_tagging_disabled",
    404: "not_staff_hidden_or_not_found",
    422: "invalid_parameters",
    429: "rate_limited",
    500: "upstream_error",
  };
  for (const [statusText, code] of Object.entries(expected)) {
    const status = Number(statusText);
    const result = tagGroupError("Failed operation", new HttpError(status, `HTTP ${status}`, { secret: "do-not-leak" }));
    assert.equal(body(result).code, code);
    assert.doesNotMatch(JSON.stringify(body(result)), /do-not-leak/);
    if (status === 429) assert.equal(body(result).retryable, true);
  }
});

test("handlers surface upstream non-staff 404 and tagging-disabled 403 without leaking bodies", async () => {
  const hidden = mockFetch(() => Response.json({ secret: "classified-body" }, { status: 404 }));
  try {
    const result = await harness().invoke("discourse_list_tag_groups", {});
    assert.equal(body(result).code, "not_staff_hidden_or_not_found");
    assert.doesNotMatch(JSON.stringify(body(result)), /classified-body/);
  } finally { hidden.restore(); }

  const disabled = mockFetch((request) => {
    if (request.url.endsWith("/tag_groups.json") && request.method === "GET") return Response.json({ tag_groups: [] });
    if (request.url.endsWith("/tags.json")) return Response.json({ tags });
    return Response.json({ secret: "tagging disabled" }, { status: 403 });
  });
  try {
    const result = await harness().invoke("discourse_create_tag_group", {
      name: "Disabled", tags: [{ id: 1 }], permissions: { "0": 1 }, allow_tag_creation: false,
    });
    assert.equal(body(result).code, "insufficient_permission_or_tagging_disabled");
    assert.doesNotMatch(JSON.stringify(body(result)), /tagging disabled/);
  } finally { disabled.restore(); }

  const scopedDelete = body(tagGroupError("Failed to delete tag group", new HttpError(403, "forbidden", { secret: true })));
  assert.match(scopedDelete.scoped_api_key_limitation, /scoped tag_groups action map/);
});

test("malformed tag-group upstream data returns normal unstructured tool errors", async () => {
  const mock = mockFetch((request) => request.url.endsWith("/tag_groups.json")
    ? Response.json({ tag_groups: [{ id: "bad", name: "Broken" }] })
    : Response.json({ tag_group: { id: "bad" } }));
  try {
    const api = harness();
    for (const [name, input] of [
      ["discourse_list_tag_groups", {}],
      ["discourse_get_tag_group", { id: 7 }],
    ] as const) {
      const result = await api.invoke(name, input);
      assert.equal(result.isError, true);
      assert.equal((result as any).structuredContent, undefined);
    }
  } finally { mock.restore(); }
});

test("real MCP output validation covers all six tag-group success paths", async () => {
  const api = harness();
  const server = new McpServer({ name: "tag-groups-all-test", version: "1" });
  const client = new Client({ name: "tag-groups-all-client", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  registerToolDefinitions(tagGroupTools, { ...api.ctx, server }, api.opts);
  let state = rawGroup();
  let exists = true;
  const mutationTimes: number[] = [];
  const mock = mockFetch(async (request) => {
    const url = new URL(request.url);
    if (url.pathname === "/tag_groups/filter/search.json") return Response.json({ results: [{ name: state.name, tags: state.tags }] });
    if (url.pathname === "/tag_groups.json" && request.method === "GET") return Response.json({ tag_groups: exists ? [state] : [] });
    if (url.pathname === "/tags.json") return Response.json({ tags });
    if (url.pathname === "/tag_groups.json" && request.method === "POST") {
      mutationTimes.push(Date.now());
      return Response.json({ tag_group: rawGroup({ id: 8, name: "Created" }) });
    }
    if (url.pathname === "/tag_groups/7.json" && request.method === "GET") {
      return exists ? Response.json({ tag_group: state }) : Response.json({ error: "not found" }, { status: 404 });
    }
    if (url.pathname === "/tag_groups/7.json" && request.method === "PUT") {
      mutationTimes.push(Date.now());
      const payload = await request.json() as any;
      state = rawGroup({ name: payload.tag_group.name, one_per_topic: payload.tag_group.one_per_topic });
      return Response.json({ success: "OK", tag_group: state });
    }
    if (url.pathname === "/tag_groups/7.json" && request.method === "DELETE") {
      mutationTimes.push(Date.now());
      exists = false;
      return Response.json({ success: "OK" });
    }
    return Response.json({});
  });
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const advertised = await client.listTools();
    assert.deepEqual(advertised.tools.map((tool) => tool.name), tagGroupTools.map((tool) => tool.name));
    assert.ok(advertised.tools.every((tool) => tool.outputSchema));

    for (const call of [
      { name: "discourse_search_tag_groups", arguments: {} },
      { name: "discourse_list_tag_groups", arguments: {} },
      { name: "discourse_get_tag_group", arguments: { id: 7 } },
      { name: "discourse_create_tag_group", arguments: { name: "Created", tags: [{ id: 1 }], permissions: { "0": 1 }, allow_tag_creation: false } },
      { name: "discourse_update_tag_group", arguments: {
        id: 7,
        expected_state_hash: normalizeTagGroup(state).state_hash,
        one_per_topic: true,
        acknowledge_possible_synthetic_permission_materialization: true,
      } },
    ]) {
      const result = await client.callTool(call);
      assertStructured(result);
    }
    const deleteResult = await client.callTool({ name: "discourse_delete_tag_group", arguments: {
      id: 7,
      name: "Editorial",
      expected_state_hash: normalizeTagGroup(state).state_hash,
      confirm_delete: true,
      acknowledge_category_relationship_removal: true,
      acknowledge_unresolved_plugin_dependencies: true,
    } });
    assertStructured(deleteResult);
    assert.equal(mutationTimes.length, 3);
    assert.ok(mutationTimes[1] - mutationTimes[0] >= 900);
    assert.ok(mutationTimes[2] - mutationTimes[1] >= 900);
  } finally {
    mock.restore();
    await client.close();
    await server.close();
  }
});

test("real MCP registration advertises and validates tag-group structured read success paths", async () => {
  const api = harness();
  const server = new McpServer({ name: "tag-groups-test", version: "1" });
  const client = new Client({ name: "tag-groups-client", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  registerToolDefinitions(tagGroupTools, { ...api.ctx, server }, { ...api.opts, allowWrites: false });
  const mock = mockFetch((request) => {
    if (request.url.includes("/filter/search")) return Response.json({ results: [{ name: "Editorial", tags: [tags[0]] }] });
    if (request.url.endsWith("/tag_groups.json")) return Response.json({ tag_groups: [rawGroup()] });
    return Response.json({ tag_group: rawGroup() });
  });
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name), tagGroupTools.slice(0, 3).map((tool) => tool.name));
    assert.ok(listed.tools.every((tool) => tool.outputSchema));
    for (const call of [
      { name: "discourse_search_tag_groups", arguments: {} },
      { name: "discourse_list_tag_groups", arguments: {} },
      { name: "discourse_get_tag_group", arguments: { id: 7 } },
    ]) {
      const result = await client.callTool(call);
      assertStructured(result);
    }
  } finally {
    mock.restore();
    await client.close();
    await server.close();
  }
});
