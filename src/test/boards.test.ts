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
import { boardTools } from "../tools/builtin/boards/index.js";
import { boardsError } from "../tools/builtin/boards/common.js";

const columns = [
  { id: 21, title: "Todo", unicode_title: "Todo", icon: "list", position: 0, default_sort: "priority", tag_id: 31, tag_name: "todo", move_to_category_id: null, move_to_assigned: null, move_to_status: "open", color: "e45735" },
  { id: 22, title: "Doing", unicode_title: "Doing", icon: null, position: 1, default_sort: "priority", tag_id: null, tag_name: null, move_to_category_id: 9, move_to_assigned: "nobody", move_to_status: null, color: null },
  { id: 23, title: "Recent", unicode_title: "Recent", icon: null, position: 2, default_sort: "recency", tag_id: null, tag_name: null, move_to_category_id: null, move_to_assigned: null, move_to_status: null, color: null },
];
const acl = [
  { type: "group", id: 1, mandatory: true, permission: "manage", display_name: "admins", metadata: { auto_group: true }, target_id: 7, target_type: "Boards::Board" },
  { type: "user", id: 1, mandatory: false, permission: "owner", display_name: "Sam", avatar_template: "/a/{size}.png", username: "sam", target_id: 7, target_type: "Boards::Board" },
];
function rawBoard(overrides: Record<string, unknown> = {}) {
  return { id: 7, name: "Roadmap", unicode_name: "Roadmap", slug: "roadmap", category_ids: [4], tag_ids: [11], tag_names: ["roadmap"], anonymous_can_read: false, require_confirmation: true, show_tags: false, card_style: "detailed", show_topic_thumbnail: false, archived: false, old_slug_used: false, can_archive: true, can_unarchive: false, can_write: true, can_manage: true, can_manage_acl_owner: true, owners: [{ id: 1, username: "sam", name: "Sam", avatar_template: "/a/{size}.png" }], columns: structuredClone(columns), acl: null, ...overrides };
}
function topicCard(overrides: Record<string, unknown> = {}) {
  return { id: 101, board_id: 7, column_id: 21, card_type: "topic", position: 65536, title: null, unicode_title: "Fix login", inline_onebox_data: null, notes: null, tag_ids: [], tags: [], topic_id: 55, updated_at: "2026-11-01T00:00:00.000Z", column_changed_at: "2026-11-01T00:00:00.000Z", recency_at: "2026-11-02T00:00:00.000Z", topic: { id: 55, title: "Fix login", unicode_title: "Fix login", slug: "fix-login", category_id: 4, tags: ["roadmap", "todo"], bumped_at: "2026-11-02T00:00:00.000Z", closed: false, image_url: null, posts_count: 3, highest_post_number: 3, last_poster: { username: "alice", avatar_template: "/a/{size}.png" }, assigned_to_user: { username: "bob", avatar_template: "/a/{size}.png" }, assignments: [{ target_type: "Topic", target_id: 55, username: "bob", avatar_template: "/a/{size}.png" }] }, ...overrides };
}
function floaterCard(overrides: Record<string, unknown> = {}) {
  return { id: 102, board_id: 7, column_id: 21, card_type: "floater", position: 131072, title: "Write docs", unicode_title: "Write docs", inline_onebox_data: null, notes: "Long notes", tag_ids: [31], tags: [{ id: 31, name: "todo", slug: "todo" }], created_at: "2026-11-01T00:00:00.000Z", updated_at: "2026-11-01T00:00:00.000Z", column_changed_at: "2026-11-01T00:00:00.000Z", recency_at: "2026-11-01T00:00:00.000Z", created_by: { username: "sam" }, assigned_to: { type: "User", username: "bob", avatar_template: "/a/{size}.png" }, ...overrides };
}
function show(boardOverrides: Record<string, unknown> = {}, cardLists: any[][] = [[topicCard(), floaterCard()], [], []]) {
  return { board: rawBoard({ acl: structuredClone(acl), ...boardOverrides }), columns: columns.map((column, i) => ({ ...column, cards: cardLists[i] ?? [] })) };
}
const constraintsOk: { categories_needed: number[]; tags_needed: string[]; constraints_need_fixing: boolean } = { categories_needed: [], tags_needed: [], constraints_need_fixing: false };
const constraintsMismatch = { categories_needed: [4], tags_needed: ["roadmap"], constraints_need_fixing: true };
const p = "/boards/api/boards/7";
const toolNames = ["list_boards", "get_board", "list_topic_boards", "create_board_card", "move_board_card", "update_board_card", "delete_board_card", "create_board_column", "update_board_column", "move_board_column", "clear_board_column", "delete_board_column", "create_board", "update_board", "set_board_archived", "delete_board"].map((name) => `discourse_${name}`);
let siteCounter = 0;
function harness(authenticated = true, allowWrites = true) {
  const logger = new Logger("silent");
  const siteState = new SiteState({ logger, timeoutMs: 5000, defaultAuth: authenticated ? { type: "user_api_key", key: "key" } : { type: "none" } });
  const base = `https://boards-${++siteCounter}.example.com`;
  siteState.selectSite(base);
  const ctx: ToolContext = { server: {} as any, siteState, logger, maxReadLength: 1000 };
  const opts: ToolRegistrationOptions = { allowWrites, toolsMode: "discourse_api_only", toolsets: ["boards"] };
  return { base, ctx, opts, invoke: (name: string, input: Record<string, unknown>) => {
    const tool = boardTools.find((tool) => tool.name === (name.startsWith("discourse_") ? name : `discourse_${name}`));
    assert.ok(tool);
    return tool.handler(input as any, {} as any, ctx, opts);
  } };
}
function body(result: any) { return JSON.parse(result.content[0].text); }
function assertStructured(result: any) {
  assert.notEqual(result.isError, true, JSON.stringify(body(result)));
  assert.deepEqual(result.structuredContent, body(result));
  return body(result);
}
function assertError(result: any, code?: string) {
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent, undefined);
  if (code) assert.equal(body(result).code, code);
  return body(result);
}
function mockFetch(responder: (request: Request, index: number) => Response | Promise<Response>) {
  const original = globalThis.fetch;
  const requests: Request[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    requests.push(request.clone());
    return responder(request, requests.length - 1);
  }) as any;
  return { requests, restore: () => { globalThis.fetch = original; } };
}
type Step = [method: string, path: string, response: unknown, requestBody?: unknown, status?: number];
/** Exact ordered wire assertions happen outside fetch so a handler cannot swallow test failures. */
async function scripted(name: string, input: Record<string, unknown>, steps: Step[], authenticated = true, allowWrites = true) {
  const api = harness(authenticated, allowWrites);
  const mock = mockFetch((_request, index) => {
    const step = steps[index];
    if (!step) return Response.json({ errors: ["Unexpected request"] }, { status: 400 });
    if (step[2] instanceof Error) throw step[2];
    return step[4] === 204 ? new Response(null, { status: 204 }) : Response.json(step[2], { status: step[4] ?? 200 });
  });
  try {
    const result = await api.invoke(name, input);
    assert.equal(mock.requests.length, steps.length, `${name}: request count; ${JSON.stringify(body(result))}`);
    for (let i = 0; i < steps.length; i++) {
      const [method, path, , expectedBody] = steps[i];
      const request = mock.requests[i];
      assert.equal(request.method, method);
      assert.equal(request.url, `${api.base}${path}`);
      const text = await request.text();
      assert.deepEqual(text ? JSON.parse(text) : undefined, expectedBody);
    }
    return { result, base: api.base };
  } finally { mock.restore(); }
}
const getStep = (fixture = show()): Step => ["GET", `${p}.json`, fixture];
const preflight = (response: unknown = constraintsOk, topicId = 55, columnId = 21): Step => ["PUT", `${p}/check-constraint-mismatches.json`, response, { topic_id: topicId, target_column_id: columnId }];
const tagStep = (name: string, stored: string | null = name): Step => ["GET", `/tags/filter/search.json?q=${encodeURIComponent(name)}&limit=5`, { results: stored === null ? [] : [{ id: stored === "roadmap" ? 11 : 31, name: stored, text: stored, count: 0 }] }];

test("boards catalog has exactly 16 ordered opt-in tools, validated outputs and correct annotations", () => {
  assert.deepEqual(boardTools.map((tool) => tool.name), toolNames);
  const nonDestructive = new Set([3, 7, 9, 12, 14]);
  boardTools.forEach((tool, i) => {
    assert.deepEqual(tool.toolsets, ["boards"]);
    assert.ok(tool.outputSchema);
    assert.equal(tool.availability, i < 3 ? "always" : "writes_enabled");
    assert.equal(tool.annotations?.readOnlyHint, i < 3);
    assert.equal(tool.annotations?.destructiveHint, i >= 3 && !nonDestructive.has(i));
    assert.equal(tool.annotations?.idempotentHint, i < 3);
    assert.equal(tool.annotations?.openWorldHint, true);
  });
});

for (const [minimum, allowed] of [["view", "view,edit,manage"], ["edit", "edit,manage"], ["manage", "manage"]]) {
  test(`list boards maps ${minimum} permission and allows anonymous public reads`, async () => {
    const { result, base } = await scripted("list_boards", { min_permission: minimum }, [["GET", `/boards/api/boards.json?allowed_permissions=${allowed}`, { boards: [rawBoard(), rawBoard({ id: 8, archived: true })] }]], false, false);
    const data = assertStructured(result);
    assert.deepEqual(data.meta, { returned: 1, total: 2, min_permission: minimum, include_archived: false });
    assert.equal(data.boards[0].url, `${base}/boards/roadmap/7`);
    assert.deepEqual(data.boards[0].owners, [{ id: 1, username: "sam", name: "Sam" }]);
    assert.equal(data.boards[0].columns[0].tag_name, "todo");
    assert.equal(data.boards[0].columns[1].move_to_assigned, "nobody");
  });
}
test("list boards filters query case-insensitively by name/slug, includes archived explicitly and preserves order", async () => {
  const { result } = await scripted("list_boards", { include_archived: true, query: " ROAD " }, [["GET", "/boards/api/boards.json?allowed_permissions=view,edit,manage", { boards: [rawBoard({ id: 8, archived: true }), rawBoard({ id: 9, name: "Other", slug: "road-stuff" }), rawBoard({ id: 10, name: "No", slug: "no" })] }]]);
  const data = assertStructured(result);
  assert.deepEqual(data.boards.map((board: any) => board.id), [8, 9]);
  assert.equal(data.meta.query, "ROAD");
});
for (const raw of [{ boards: {} }, { boards: [rawBoard({ id: -1 })] }, { boards: [rawBoard({ category_ids: "bad" })] }, { boards: [rawBoard({ name: "", unicode_name: "", slug: "" })] }, { boards: [rawBoard({ columns: [{ id: 21 }] })] }]) {
  test("list boards rejects malformed essential upstream fields as unstructured errors", async () => {
    const { result } = await scripted("list_boards", {}, [["GET", "/boards/api/boards.json?allowed_permissions=view,edit,manage", raw]]);
    assertError(result, "malformed_upstream_response");
  });
}
test("list boards disabled plugin or invisible board returns helpful 404 causes", async () => {
  const { result } = await scripted("list_boards", {}, [["GET", "/boards/api/boards.json?allowed_permissions=view,edit,manage", { errors: ["Board not found"], error_type: "not_found" }, undefined, 404]]);
  const error = assertError(result, "boards_unavailable_or_not_found");
  assert.equal(error.status, 404);
  assert.equal(error.possible_causes.length, 2);
  assert.deepEqual(error.errors, ["Board not found"]);
});
test("get board projects exact topic/floater fixtures, URLs, ACL and assignment subsets", async () => {
  const { result, base } = await scripted("get_board", { board_id: 7 }, [getStep()], false, false);
  const data = assertStructured(result);
  assert.equal(data.board.columns, undefined);
  assert.deepEqual(data.board.acl, [{ type: "group", id: 1, permission: "manage", display_name: "admins", mandatory: true }, { type: "user", id: 1, permission: "owner", display_name: "Sam", username: "sam", mandatory: false }]);
  const [topic, floater] = data.columns[0].cards;
  assert.deepEqual(topic, { id: 101, board_id: 7, column_id: 21, type: "topic", position: 65536, title: "Fix login", url: `${base}/boards/roadmap/7/cards/101`, column_changed_at: "2026-11-01T00:00:00.000Z", recency_at: "2026-11-02T00:00:00.000Z", topic: { id: 55, title: "Fix login", slug: "fix-login", url: `${base}/t/fix-login/55`, category_id: 4, tags: ["roadmap", "todo"], closed: false, posts_count: 3, bumped_at: "2026-11-02T00:00:00.000Z", last_poster_username: "alice", assigned_to_user: { username: "bob" }, assignments: [{ target_type: "Topic", target_id: 55, username: "bob" }] } });
  assert.equal(floater.title, "Write docs");
  assert.equal(floater.url, `${base}/boards/roadmap/7/cards/102`);
  assert.deepEqual(floater.tags, ["todo"]);
  assert.deepEqual(floater.assigned_to, { type: "User", username: "bob" });
  assert.equal(floater.notes, "Long notes");
  assert.equal(floater.created_by_username, "sam");
  assert.equal(floater.created_at, "2026-11-01T00:00:00.000Z");
  assert.deepEqual(data.meta, { total_cards: 2, matching_cards: 2, returned_cards: 2, truncated: false, max_cards_per_column: 50 });
});
test("get board preserves included group/post assignment keys and omits absent topic assignment keys", async () => {
  const raw = topicCard();
  const topic: any = { ...raw.topic, assigned_to_user: undefined, assignments: [{ target_type: "Post", target_id: 99, group_name: "designers", post_number: 2 }], assigned_to_group: { name: "designers", id: 44 } };
  const { result } = await scripted("get_board", { board_id: 7 }, [getStep(show({ acl: null }, [[topicCard({ topic }), floaterCard({ assigned_to: { type: "Group", name: "designers" } })]]))]);
  const data = assertStructured(result);
  assert.equal(data.board.acl, null);
  assert.equal(data.columns[0].cards[0].topic.assigned_to_user, undefined);
  assert.deepEqual(data.columns[0].cards[0].topic.assigned_to_group, { name: "designers" });
  assert.deepEqual(data.columns[0].cards[0].topic.assignments, [{ target_type: "Post", target_id: 99, group_name: "designers", post_number: 2 }]);
  assert.deepEqual(data.columns[0].cards[1].assigned_to, { type: "Group", name: "designers" });
});
test("get board validates column IDs and lists available columns", async () => {
  const { result } = await scripted("get_board", { board_id: 7, column_ids: [99] }, [getStep()]);
  assert.deepEqual(assertError(result, "unknown_column_ids").available_column_ids, [21, 22, 23]);
});
test("get board applies AND card filters, reports missing IDs and truncates notes", async () => {
  const { result } = await scripted("get_board", { board_id: 7, column_ids: [21], card_ids: [101, 102, 999], card_query: "DOC", notes_max_chars: 4 }, [getStep()]);
  const data = assertStructured(result);
  assert.equal(data.columns.length, 1);
  assert.equal(data.columns[0].total_card_count, 2);
  assert.equal(data.columns[0].card_count, 1);
  assert.equal(data.columns[0].cards[0].notes, "Long");
  assert.equal(data.columns[0].cards[0].notes_truncated, true);
  assert.deepEqual(data.meta.missing_card_ids, [999]);
  assert.equal(data.meta.matching_cards, 1);
});
test("get board caps cards preserving upstream order and can truncate notes to zero", async () => {
  const { result } = await scripted("get_board", { board_id: 7, max_cards_per_column: 1, notes_max_chars: 0 }, [getStep(show({}, [[floaterCard(), topicCard()]]))]);
  const data = assertStructured(result);
  assert.equal(data.columns[0].cards[0].id, 102);
  assert.equal(data.columns[0].cards[0].notes, "");
  assert.equal(data.columns[0].cards[0].notes_truncated, true);
  assert.equal(data.columns[0].truncated, true);
  assert.deepEqual(data.meta, { total_cards: 2, matching_cards: 2, returned_cards: 1, truncated: true, max_cards_per_column: 1 });
});
for (const overrides of [{ card_type: "other" }, { id: 0 }, { column_id: "bad" }]) {
  test("get board malformed card essentials return malformed upstream error", async () => {
    const { result } = await scripted("get_board", { board_id: 7 }, [getStep(show({}, [[floaterCard(overrides)]]))]);
    assertError(result, "malformed_upstream_response");
  });
}
test("list topic boards uses exact query and normalizes membership, card IDs and unicode names", async () => {
  const available = { boards: [{ id: 7, unicode_name: "Roadmap", slug: "roadmap", topic_is_member: true, columns: [{ id: 21, unicode_title: "Todo", icon: "list", color: "e45735", topic_is_member: true, topic_card_id: 101 }, { id: 22, unicode_title: "Doing", icon: null, color: null, topic_is_member: false, topic_card_id: null }] }, { id: 8, unicode_name: "Empty", slug: "empty", columns: [{ id: 25, unicode_title: "New" }] }] };
  const { result, base } = await scripted("list_topic_boards", { topic_id: 55, min_permission: "edit" }, [["GET", "/boards/api/boards/available.json?topic_id=55&allowed_permissions=edit,manage", available]], false, false);
  const data = assertStructured(result);
  assert.equal(data.boards[0].url, `${base}/boards/roadmap/7`);
  assert.equal(data.boards[0].name, "Roadmap");
  assert.equal(data.boards[0].columns[0].topic_card_id, 101);
  assert.equal(data.boards[1].topic_is_member, false);
  assert.deepEqual(data.boards[1].columns[0], { id: 25, title: "New", icon: null, color: null, topic_is_member: false, topic_card_id: null });
  assert.deepEqual(data.meta, { returned: 2, min_permission: "edit" });
});

for (const fields of [{}, { title: "X", topic_id: 55 }, { topic_id: 55, notes: "bad" }, { topic_id: 55, tag_names: ["todo"] }, { topic_id: 55, assignee: "sam" }, { title: "X", constraint_fix: { category_id: 4 } }]) {
  test("create card rejects exclusivity and topic/floater field conflicts before HTTP", async () => {
    const { result } = await scripted("create_board_card", { board_id: 7, column_id: 21, ...fields }, []);
    assertError(result);
    assert.match(body(result).error, /[Vv]alidation/);
  });
}
test("create topic card preflights constraints and sends exact minimal wrapper, no invented card URL", async () => {
  const { result } = await scripted("create_board_card", { board_id: 7, column_id: 21, topic_id: 55 }, [preflight(), ["POST", `${p}/cards.json`, { card: topicCard() }, { card: { column_id: 21, topic_id: 55 } }]]);
  const data = assertStructured(result);
  assert.equal(data.card.url, null);
  assert.equal(data.card.topic.id, 55);
});
test("create topic card refuses constraint mismatch without explicit repair and does not POST", async () => {
  const { result } = await scripted("create_board_card", { board_id: 7, column_id: 21, topic_id: 55 }, [preflight(constraintsMismatch)]);
  const error = assertError(result, "constraint_mismatch");
  assert.deepEqual(error.categories_needed, [4]);
  assert.deepEqual(error.tags_needed, ["roadmap"]);
  assert.match(error.error, /changes the topic/);
});
test("create topic card sends explicit constraint_fix outside card and never tag-guards it", async () => {
  const fix = { category_id: 4, tag_names: ["roadmap"] };
  const { result } = await scripted("create_board_card", { board_id: 7, column_id: 21, topic_id: 55, constraint_fix: fix }, [preflight(constraintsMismatch), ["POST", `${p}/cards.json`, { card: topicCard() }, { card: { column_id: 21, topic_id: 55 }, constraint_fix: fix }]]);
  assertStructured(result);
});
test("create topic card drops unneeded fix with exact warning", async () => {
  const { result } = await scripted("create_board_card", { board_id: 7, column_id: 21, topic_id: 55, constraint_fix: { category_id: 4 } }, [preflight(), ["POST", `${p}/cards.json`, { card: topicCard() }, { card: { column_id: 21, topic_id: 55 } }]]);
  assert.deepEqual(assertStructured(result).warnings, ["constraint_fix ignored: the topic already matches the board constraints"]);
});
test("create floater tag guard rejects unknown tag without POST", async () => {
  const { result } = await scripted("create_board_card", { board_id: 7, column_id: 21, title: "New", tag_names: ["unknown"] }, [tagStep("unknown", null)]);
  assertError(result, "tag_creation_not_allowed");
});
test("create floater sends only provided floater keys with assignee mapping and explicit tag creation", async () => {
  const { result } = await scripted("create_board_card", { board_id: 7, column_id: 21, title: " Write docs ", notes: "Long notes", tag_names: ["todo"], assignee: "bob", allow_tag_creation: true }, [tagStep("todo", null), ["POST", `${p}/cards.json`, { card: floaterCard() }, { card: { column_id: 21, title: "Write docs", notes: "Long notes", tag_names: ["todo"], assigned_to_name: "bob" } }]]);
  assertStructured(result);
});
test("create floater omits every optional key when absent", async () => {
  const { result } = await scripted("create_board_card", { board_id: 7, column_id: 21, title: "X" }, [["POST", `${p}/cards.json`, { card: floaterCard() }, { card: { column_id: 21, title: "X" } }]]);
  assertStructured(result);
});
for (const failure of [500, new Error("socket closed")]) {
  test("create mutation outcome is unknown after a single non-retried POST on 5xx/network failure", async () => {
    const { result } = await scripted("create_board_card", { board_id: 7, column_id: 21, title: "X" }, [["POST", `${p}/cards.json`, typeof failure === "number" ? {} : failure, { card: { column_id: 21, title: "X" } }, typeof failure === "number" ? failure : undefined]]);
    const error = assertError(result, "outcome_unknown");
    assert.equal(error.retryable, false);
    assert.equal(error.board_id, 7);
    assert.match(error.error, /discourse_get_board/);
  });
}
test("create card maps 403 upstream errors and permission hints", async () => {
  const { result } = await scripted("create_board_card", { board_id: 7, column_id: 21, title: "X" }, [["POST", `${p}/cards.json`, { errors: ["Cannot assign"], error_type: "invalid_access" }, { card: { column_id: 21, title: "X" } }, 403]]);
  const error = assertError(result, "insufficient_permission");
  assert.deepEqual(error.errors, ["Cannot assign"]);
  assert.equal(error.error_type, "invalid_access");
  assert.ok(error.possible_causes.some((cause: string) => cause.includes("discourse-assign")));
});

const moveFirst: Record<string, unknown> = { board_id: 7, card_id: 102, placement: "first" };
test("move first sends after_card_id null as a present key and includes fetched board URL/from/to", async () => {
  const { result, base } = await scripted("move_board_card", moveFirst, [getStep(), ["PUT", `${p}/cards/102.json`, { card: floaterCard() }, { card: { column_id: 21, after_card_id: null } }]]);
  const data = assertStructured(result);
  assert.equal(data.card.url, `${base}/boards/roadmap/7/cards/102`);
  assert.deepEqual(data.from_column, { id: 21, title: "Todo" });
  assert.deepEqual(data.to_column, { id: 21, title: "Todo" });
  assert.equal(data.applied_column_rules, null);
});
test("move last across priority columns omits after_card_id instead of sending null", async () => {
  const { result } = await scripted("move_board_card", { board_id: 7, card_id: 102, to_column_id: 22, placement: "last", confirm_move: true }, [getStep(), ["PUT", `${p}/cards/102.json`, { card: floaterCard({ column_id: 22 }) }, { card: { column_id: 22 } }]]);
  assert.equal(assertStructured(result).to_column.id, 22);
});
test("move last within a priority column uses last other card as anchor", async () => {
  const { result } = await scripted("move_board_card", { board_id: 7, card_id: 101, placement: "last" }, [getStep(), ["PUT", `${p}/cards/101.json`, { card: topicCard() }, { card: { column_id: 21, after_card_id: 102 } }]]);
  assertStructured(result);
});
for (const input of [moveFirst, { board_id: 7, card_id: 102, placement: "last" }, { board_id: 7, card_id: 102, placement: "after", after_card_id: 101 }, { board_id: 7, card_id: 102, to_column_id: 21 }]) {
  test("move card detects already-first/last/after and unchanged-column no-ops without PUT", async () => {
    const fixture = input.placement === "first" ? show({}, [[floaterCard(), topicCard()]]) : show();
    const { result } = await scripted("move_board_card", input, [getStep(fixture)]);
    assertError(result, "no_op");
  });
}
for (const anchor of [102, 999]) {
  test("move after rejects self or non-visible target-column anchor without mutation", async () => {
    const { result } = await scripted("move_board_card", { board_id: 7, card_id: 102, placement: "after", after_card_id: anchor }, [getStep()]);
    assertError(result, "invalid_after_card");
  });
}
test("move after validates target-column membership and sends anchor when valid", async () => {
  const fixture = show({}, [[topicCard(), floaterCard(), floaterCard({ id: 103 })]]);
  const { result } = await scripted("move_board_card", { board_id: 7, card_id: 101, placement: "after", after_card_id: 103 }, [getStep(fixture), ["PUT", `${p}/cards/101.json`, { card: topicCard() }, { card: { column_id: 21, after_card_id: 103 } }]]);
  assertStructured(result);
});
test("move after rejects an anchor in the source rather than target column", async () => {
  const { result } = await scripted("move_board_card", { board_id: 7, card_id: 102, to_column_id: 22, placement: "after", after_card_id: 101, confirm_move: true }, [getStep()]);
  assertError(result, "invalid_after_card");
});
test("same recency column cannot be reordered", async () => {
  const { result } = await scripted("move_board_card", { board_id: 7, card_id: 102, placement: "first" }, [getStep(show({}, [[], [], [floaterCard({ column_id: 23 })]]))]);
  assertError(result, "recency_column_reorder");
});
test("cross-column recency move warns and sends no after_card_id even for explicit first", async () => {
  const { result } = await scripted("move_board_card", { board_id: 7, card_id: 102, to_column_id: 23, placement: "first", confirm_move: true }, [getStep(), ["PUT", `${p}/cards/102.json`, { card: floaterCard({ column_id: 23 }) }, { card: { column_id: 23 } }]]);
  assert.deepEqual(assertStructured(result).warnings, ["placement ignored: recency-sorted columns place moved cards first"]);
});
test("move topic_id resolves single card, applies rules and checks constraints only across columns", async () => {
  const { result } = await scripted("move_board_card", { board_id: 7, topic_id: 55, to_column_id: 22, confirm_move: true }, [getStep(), preflight(constraintsOk, 55, 22), ["PUT", `${p}/cards/101.json`, { card: topicCard({ column_id: 22, topic: { ...topicCard().topic, category_id: 9 } }) }, { card: { column_id: 22 } }]]);
  const data = assertStructured(result);
  assert.deepEqual(data.applied_column_rules, { tag_name: null, move_to_category_id: 9, move_to_assigned: "nobody", move_to_status: null, board_has_tagged_columns: true });
  assert.equal(data.card.topic.category_id, 9);
  assert.equal(data.from_column.id, 21);
});
test("ambiguous topic_id lists card and column identities without PUT", async () => {
  const { result } = await scripted("move_board_card", { board_id: 7, topic_id: 55, placement: "first" }, [getStep(show({}, [[topicCard()], [topicCard({ id: 103, column_id: 22 })]]))]);
  assert.deepEqual(assertError(result, "ambiguous_topic_card").cards, [{ card_id: 101, column_id: 21, column_title: "Todo" }, { card_id: 103, column_id: 22, column_title: "Doing" }]);
});
for (const input of [{ topic_id: 999 }, { card_id: 999 }]) {
  test("move missing card/topic fails before mutation", async () => {
    const { result } = await scripted("move_board_card", { board_id: 7, ...input, placement: "first" }, [getStep()]);
    assertError(result, "card_not_found");
  });
}
test("move unknown column returns available column identities", async () => {
  const { result } = await scripted("move_board_card", { board_id: 7, card_id: 101, to_column_id: 999 }, [getStep()]);
  assert.deepEqual(assertError(result, "column_not_found").available_columns, columns.map(({ id, title }) => ({ id, title })));
});
test("require_confirmation prevents PUT/preflight and describes target topic rules", async () => {
  const { result } = await scripted("move_board_card", { board_id: 7, card_id: 101, to_column_id: 22 }, [getStep()]);
  const error = assertError(result, "confirmation_required");
  assert.equal(error.applied_column_rules.move_to_category_id, 9);
  assert.equal(error.applied_column_rules.move_to_assigned, "nobody");
});
test("move topic constraint mismatch stops PUT; explicit fix is sent only when needed", async () => {
  const input = { board_id: 7, card_id: 101, to_column_id: 22, confirm_move: true };
  const rejected = await scripted("move_board_card", input, [getStep(), preflight(constraintsMismatch, 55, 22)]);
  assertError(rejected.result, "constraint_mismatch");
  const fix = { category_id: 4, tag_names: ["roadmap"] };
  const accepted = await scripted("move_board_card", { ...input, constraint_fix: fix }, [getStep(show({ category_ids: [4, 9] })), preflight(constraintsMismatch, 55, 22), ["PUT", `${p}/cards/101.json`, { card: topicCard({ column_id: 22 }) }, { card: { column_id: 22 }, constraint_fix: fix }]]);
  assertStructured(accepted.result);
});
test("same-column topic reorder drops constraint_fix with warning and sends no preflight", async () => {
  const { result } = await scripted("move_board_card", { board_id: 7, card_id: 101, placement: "last", constraint_fix: { category_id: 4 } }, [getStep(), ["PUT", `${p}/cards/101.json`, { card: topicCard() }, { card: { column_id: 21, after_card_id: 102 } }]]);
  assert.match(assertStructured(result).warnings[0], /constraint_fix ignored/);
});
for (const [fixture, input, code] of [
  [show(), { ...moveFirst, constraint_fix: { category_id: 4 } }, "invalid_parameters"],
  [show({ archived: true }), moveFirst, "board_archived"],
  [show({ can_write: false }), moveFirst, "board_not_writable"],
] as const) {
  test(`move card locally rejects ${code} without PUT`, async () => {
    const { result } = await scripted("move_board_card", input, [getStep(fixture)]);
    assertError(result, code);
  });
}
test("move card 5xx has unknown outcome and exactly one PUT", async () => {
  const { result } = await scripted("move_board_card", moveFirst, [getStep(), ["PUT", `${p}/cards/102.json`, {}, { card: { column_id: 21, after_card_id: null } }, 503]]);
  assertError(result, "outcome_unknown");
});
for (const input of [{ board_id: 7, placement: "first" }, { board_id: 7, card_id: 101, topic_id: 55, placement: "first" }, { board_id: 7, card_id: 101 }, { board_id: 7, card_id: 101, placement: "after" }, { board_id: 7, card_id: 101, placement: "last", after_card_id: 102 }]) {
  test("move card strict cross-field validation happens without HTTP", async () => {
    assertError((await scripted("move_board_card", input, [])).result);
  });
}

test("update rejects topic card field edits without PUT", async () => {
  const { result } = await scripted("update_board_card", { board_id: 7, card_id: 101, notes: "X" }, [getStep()]);
  assertError(result, "topic_card_fields_not_editable");
});
test("update floater preserves explicit clearing keys, maps assignee and sends only provided fields", async () => {
  const { result } = await scripted("update_board_card", { board_id: 7, card_id: 102, notes: null, tag_names: [], assignee: null }, [getStep(), ["PUT", `${p}/cards/102.json`, { card: floaterCard({ notes: null, tags: [], assigned_to: null }), adopted_floater_id: null }, { card: { notes: null, tag_names: [], assigned_to_name: null } }]]);
  const data = assertStructured(result);
  assert.equal(data.card.notes, null);
  assert.equal(data.adopted_floater_id, null);
});
test("update floater new tags are guarded but unchanged names are not rechecked", async () => {
  const rejected = await scripted("update_board_card", { board_id: 7, card_id: 102, tag_names: ["unknown"] }, [getStep(), tagStep("unknown", null)]);
  assertError(rejected.result, "tag_creation_not_allowed");
  const accepted = await scripted("update_board_card", { board_id: 7, card_id: 102, title: "Updated", tag_names: ["TODO"] }, [getStep(), ["PUT", `${p}/cards/102.json`, { card: floaterCard({ title: "Updated" }) }, { card: { title: "Updated", tag_names: ["TODO"] } }]]);
  assertStructured(accepted.result);
});
for (const edits of [{ title: "Write docs" }, { tag_names: ["TODO", "todo"] }, { notes: "Long notes", assignee: "bob" }, { notes: "" }]) {
  test("update floater recognizes no-op including set-based tags and null/empty notes", async () => {
    const fixture = edits.notes === "" ? show({}, [[floaterCard({ notes: null })]]) : show();
    assertError((await scripted("update_board_card", { board_id: 7, card_id: 102, ...edits }, [getStep(fixture)])).result, "no_op");
  });
}
test("promotion requires confirmation before constraint preflight or PUT", async () => {
  assertError((await scripted("update_board_card", { board_id: 7, card_id: 102, promote_to_topic_id: 55 }, [getStep()])).result, "confirmation_required");
});
test("promotion sends topic_id only, explicit fix outside card, and reports adopted floater", async () => {
  const fix = { category_id: 4, tag_names: ["roadmap"] };
  const { result } = await scripted("update_board_card", { board_id: 7, card_id: 102, promote_to_topic_id: 55, confirm_promotion: true, constraint_fix: fix }, [getStep(), preflight(constraintsMismatch), ["PUT", `${p}/cards/102.json`, { card: topicCard(), adopted_floater_id: 102 }, { card: { topic_id: 55 }, constraint_fix: fix }]]);
  const data = assertStructured(result);
  assert.equal(data.adopted_floater_id, 102);
  assert.equal(data.card.id, 101);
  assert.match(data.warnings[0], /floater was deleted/);
});
for (const input of [{ promote_to_topic_id: 55, title: "No" }, { notes: null, constraint_fix: { category_id: 4 } }, {}]) {
  test("update floater cross-field validation rejects invalid edits before GET", async () => {
    assertError((await scripted("update_board_card", { board_id: 7, card_id: 102, ...input }, [])).result);
  });
}
test("delete topic card returns pre-delete snapshot, correct DELETE and conditional tag-removal intent", async () => {
  const { result } = await scripted("delete_board_card", { board_id: 7, card_id: 101 }, [getStep(), ["DELETE", `${p}/cards/101.json`, undefined, undefined, 204]]);
  const data = assertStructured(result);
  assert.equal(data.deleted, true);
  assert.equal(data.card.title, "Fix login");
  assert.equal(data.topic_tag_removed, "todo");
  assert.deepEqual(data.column, { id: 21, title: "Todo", tag_name: "todo" });
});
test("delete floater does not claim topic tag removal", async () => {
  const { result } = await scripted("delete_board_card", { board_id: 7, card_id: 102 }, [getStep(), ["DELETE", `${p}/cards/102.json`, undefined, undefined, 204]]);
  assert.equal(assertStructured(result).topic_tag_removed, null);
});

test("create column strips color prefix, sends only provided fields, and re-reads authoritative tag/count", async () => {
  const { result } = await scripted("create_board_column", { board_id: 7, title: " Todo ", tag_name: "todo", color: "#abc" }, [tagStep("todo"), ["POST", `${p}/columns.json`, { column: { ...columns[0], tag_id: null, tag_name: null } }, { column: { title: "Todo", color: "abc", tag_name: "todo" } }], getStep()]);
  const data = assertStructured(result);
  assert.equal(data.column.tag_name, "todo");
  assert.equal(data.column.total_card_count, 2);
});
test("create column re-read failure falls back to response column, requested tag and warning", async () => {
  const { result } = await scripted("create_board_column", { board_id: 7, title: "Todo", tag_name: "todo" }, [tagStep("todo"), ["POST", `${p}/columns.json`, { column: { ...columns[0], tag_name: null } }, { column: { title: "Todo", tag_name: "todo" } }], ["GET", `${p}.json`, {}, undefined, 403]]);
  const data = assertStructured(result);
  assert.equal(data.column.tag_name, "todo");
  assert.equal(data.column.total_card_count, undefined);
  assert.ok(data.warnings.length);
});
test("create column unknown tag blocks POST", async () => {
  const { result } = await scripted("create_board_column", { board_id: 7, title: "New", tag_name: "unknown" }, [tagStep("unknown", null)]);
  assertError(result, "tag_creation_not_allowed");
});
test("update column merges all omitted values into full replacement, explicit null clears, then re-reads", async () => {
  const fixture = show();
  const updated = show();
  updated.columns[0].icon = null as any;
  updated.columns[0].title = "Ready";
  updated.columns[0].color = null as any;
  const { result } = await scripted("update_board_column", { board_id: 7, column_id: 21, title: "Ready", icon: null, color: null }, [getStep(fixture), ["PUT", `${p}/columns/21.json`, { column: { ...updated.columns[0], tag_name: null } }, { column: { title: "Ready", icon: null, color: null, default_sort: "priority", tag_name: "todo", move_to_category_id: null, move_to_assigned: null, move_to_status: "open" } }], getStep(updated)]);
  const data = assertStructured(result);
  assert.equal(data.previous.title, "Todo");
  assert.equal(data.previous.icon, "list");
  assert.equal(data.column.title, "Ready");
  assert.equal(data.column.tag_name, "todo");
  assert.equal(data.column.total_card_count, 2);
});
test("update column explicit null rule clears are sent, not treated as omission", async () => {
  const { result } = await scripted("update_board_column", { board_id: 7, column_id: 22, tag_name: null, move_to_category_id: null, move_to_assigned: null, move_to_status: null }, [getStep(), ["PUT", `${p}/columns/22.json`, { column: columns[1] }, { column: { title: "Doing", icon: null, color: null, default_sort: "priority", tag_name: null, move_to_category_id: null, move_to_assigned: null, move_to_status: null } }], getStep()]);
  assertStructured(result);
});
test("update column equal merged values are a no-op without tag lookup or PUT", async () => {
  assertError((await scripted("update_board_column", { board_id: 7, column_id: 21, title: "Todo" }, [getStep()])).result, "no_op");
});
test("update column changed tag is guarded before PUT", async () => {
  assertError((await scripted("update_board_column", { board_id: 7, column_id: 21, tag_name: "unknown" }, [getStep(), tagStep("unknown", null)])).result, "tag_creation_not_allowed");
});
test("move column swaps sequentially in positive direction and returns final order", async () => {
  const { result } = await scripted("move_board_column", { board_id: 7, column_id: 21, to_position: 2 }, [getStep(), ["POST", `${p}/move-column.json`, { column_order: [22, 21, 23] }, { column_id: 21, direction: 1 }], ["POST", `${p}/move-column.json`, { column_order: [22, 23, 21] }, { column_id: 21, direction: 1 }]]);
  assert.deepEqual(assertStructured(result), { column_id: 21, from_position: 0, to_position: 2, column_order: [22, 23, 21] });
});
test("move column negative direction uses position then id ordering", async () => {
  const { result } = await scripted("move_board_column", { board_id: 7, column_id: 23, to_position: 1 }, [getStep(), ["POST", `${p}/move-column.json`, { column_order: [21, 23, 22] }, { column_id: 23, direction: -1 }]]);
  assert.deepEqual(assertStructured(result).column_order, [21, 23, 22]);
});
for (const [position, code] of [[3, "invalid_position"], [0, "no_op"]] as const) {
  test(`move column rejects ${code} without POST`, async () => {
    const { result } = await scripted("move_board_column", { board_id: 7, column_id: 21, to_position: position }, [getStep()]);
    const error = assertError(result, code);
    if (code === "invalid_position") assert.equal(error.column_count, 3);
  });
}
for (const status of [400, 503]) {
  test(`move column mid-way ${status} preserves completed swap count and last known order`, async () => {
    const { result } = await scripted("move_board_column", { board_id: 7, column_id: 21, to_position: 2 }, [getStep(), ["POST", `${p}/move-column.json`, { column_order: [22, 21, 23] }, { column_id: 21, direction: 1 }], ["POST", `${p}/move-column.json`, { errors: ["Rejected"] }, { column_id: 21, direction: 1 }, status]]);
    const error = assertError(result, status === 400 ? "partial_move" : "outcome_unknown");
    assert.equal(error.completed_swaps, 1);
    assert.deepEqual(error.column_order, [22, 21, 23]);
    if (status === 400) assert.equal(error.upstream_error.code, "invalid_parameters");
  });
}
test("clear column requires literal confirmation before HTTP", async () => {
  assertError((await scripted("clear_board_column", { board_id: 7, column_id: 21 }, [])).result);
  assertError((await scripted("clear_board_column", { board_id: 7, column_id: 21, confirm_clear: false }, [])).result);
});
test("clear column checks expected count without DELETE", async () => {
  const { result } = await scripted("clear_board_column", { board_id: 7, column_id: 21, confirm_clear: true, expected_card_count: 3 }, [getStep()]);
  assert.equal(assertError(result, "state_conflict").current_card_count, 2);
});
test("clear column DELETE returns exact visible counts and topic-tag intent", async () => {
  const { result } = await scripted("clear_board_column", { board_id: 7, column_id: 21, confirm_clear: true, expected_card_count: 2 }, [getStep(), ["DELETE", `${p}/columns/21/cards.json`, undefined, undefined, 204]]);
  assert.deepEqual(assertStructured(result), { cleared: true, column: { id: 21, title: "Todo", tag_name: "todo" }, cards_removed: 2, topic_cards_removed: 1, floater_cards_removed: 1, topic_tag_removed: "todo" });
});
test("delete column exact title guard prevents DELETE", async () => {
  const { result } = await scripted("delete_board_column", { board_id: 7, column_id: 21, column_title: "todo", confirm_delete: true }, [getStep()]);
  assert.equal(assertError(result, "identity_mismatch").current_title, "Todo");
});
test("delete column deletes cards without claiming topic/tag removal and returns counts", async () => {
  const { result } = await scripted("delete_board_column", { board_id: 7, column_id: 21, column_title: "Todo", confirm_delete: true }, [getStep(), ["DELETE", `${p}/columns/21.json`, undefined, undefined, 204]]);
  const data = assertStructured(result);
  assert.equal(data.deleted, true);
  assert.equal(data.cards_deleted, 2);
  assert.equal(data.topic_cards_deleted, 1);
  assert.equal(data.floater_cards_deleted, 1);
  assert.equal(data.column.tag_name, "todo");
  assert.equal(data.topic_tag_removed, undefined);
});

const createBody = (fields: Record<string, unknown> = {}) => ({ board: { name: "New", require_confirmation: false, acl: [], columns: [], ...fields } });
test("create board maps all automatic groups case-insensitively without HTTP resolution", async () => {
  const entries = ["admins", "moderators", "STAFF", "anonymous_users", "logged_in_users", "trust_level_0", "trust_level_1", "trust_level_2", "trust_level_3", "trust_level_4"].map((name) => ({ type: "group", name, permission: "view" }));
  const ids = [1, 2, 3, 4, 5, 10, 11, 12, 13, 14];
  const { result } = await scripted("create_board", { name: "New", acl: entries }, [["POST", "/boards/api/boards.json", { board: rawBoard() }, createBody({ acl: ids.map((id) => ({ type: "group", id, permission: "view" })) })]]);
  const data = assertStructured(result);
  assert.equal(data.acl_applied[2].name, "STAFF");
  assert.equal(data.acl_applied[2].id, 3);
});
test("create board resolves custom group/user/owners, dedupes ACL and emits exact JSON body", async () => {
  const input = { name: " New ", slug: "new", acl: [{ type: "group", name: "designers", permission: "edit" }, { type: "user", name: "alice", permission: "manage" }, { type: "group", id: 42, permission: "edit" }], owners: ["alice"], category_ids: [4], tag_names: ["roadmap"], columns: [{ title: "Todo", icon: "list", default_sort: "priority", tag_name: "todo", move_to_category_id: 9, move_to_assigned: "nobody", move_to_status: "closed" }], card_style: "simple", show_tags: true, show_topic_thumbnail: true };
  const { result } = await scripted("create_board", input, [["GET", "/groups/designers.json", { group: { id: 42, name: "designers" } }], ["GET", "/u/alice.json?skip_track_visit=true", { user: { id: 9, username: "alice" } }], tagStep("roadmap"), tagStep("todo"), ["POST", "/boards/api/boards.json", { board: rawBoard() }, createBody({ slug: "new", category_ids: [4], tag_names: ["roadmap"], columns: input.columns, card_style: "simple", show_tags: true, show_topic_thumbnail: true, acl: [{ type: "group", id: 42, permission: "edit" }, { type: "user", id: 9, permission: "manage" }], owner_user_ids: [9] })]]);
  const data = assertStructured(result);
  assert.equal(data.acl_applied.length, 2);
  assert.deepEqual(data.owners_requested, [{ id: 9, username: "alice" }]);
});
for (const entry of [{ type: "group", name: "everyone", permission: "view" }, { type: "group", name: "anonymous_users", permission: "edit" }, { type: "group", id: 4, permission: "manage" }]) {
  test("create board bans dangerous ACL entries locally without POST", async () => {
    const { result } = await scripted("create_board", { name: "New", acl: [entry] }, []);
    assertError(result, "banned_acl_entry");
  });
}
for (const type of ["group", "user"]) {
  test(`create board unknown ${type} maps 404 to unknown_principal and never POSTs`, async () => {
    const path = type === "group" ? "/groups/missing.json" : "/u/missing.json?skip_track_visit=true";
    const { result } = await scripted("create_board", { name: "New", acl: [{ type, name: "missing", permission: "view" }] }, [["GET", path, {}, undefined, 404]]);
    assertError(result, "unknown_principal");
  });
}
for (const input of [{ name: "New" }, { name: "New", acl: [], columns: [{ title: "Todo", color: "abc" }] }, { name: "New", acl: [], columns: [{ title: "A", tag_name: "todo" }, { title: "B", tag_name: "TODO" }] }, { name: "New", acl: [{ type: "group", id: 5, name: "staff", permission: "view" }] }, { name: "New", acl: [{ type: "group", permission: "view" }] }]) {
  test("create board strict schema rejects missing ACL, unsupported column color and ambiguous/duplicate inputs before HTTP", async () => {
    assertError((await scripted("create_board", input, [])).result);
  });
}
test("create board opaque 422 returns create-specific rejected_without_details causes", async () => {
  const { result } = await scripted("create_board", { name: "New", acl: [] }, [["POST", "/boards/api/boards.json", { failed: "FAILED" }, createBody(), 422]]);
  const error = assertError(result, "rejected_without_details");
  assert.equal(error.status, 422);
  assert.ok(error.possible_causes.includes("slug already in use"));
  assert.ok(error.possible_causes.some((cause: string) => cause.includes("owners")));
});
test("create board policy 403 surfaces the upstream reason", async () => {
  const { result } = await scripted("create_board", { name: "New", acl: [] }, [["POST", "/boards/api/boards.json", { errors: ["You do not have permission to create boards"], error_type: "invalid_access" }, createBody(), 403]]);
  assert.deepEqual(assertError(result, "insufficient_permission").errors, ["You do not have permission to create boards"]);
});
test("board creation tag guard combines and dedupes board/column names into one tags fetch", async () => {
  const input = { name: "New", acl: [], tag_names: ["TODO", "todo"], columns: [{ title: "Todo", tag_name: "todo" }] };
  const { result } = await scripted("create_board", input, [tagStep("todo"), ["POST", "/boards/api/boards.json", { board: rawBoard() }, createBody({ tag_names: input.tag_names, columns: input.columns })]]);
  assertStructured(result);
});
test("update board previews resulting constraints with unchanged current tag list and blocks removal without confirmation", async () => {
  const { result } = await scripted("update_board", { board_id: 7, category_ids: [9] }, [getStep(), tagStep("roadmap"), ["POST", `${p}/constraint-preview.json`, { cards_to_remove: 2 }, { category_ids: [9], tag_names: ["roadmap"] }]]);
  assert.equal(assertError(result, "confirmation_required").cards_to_remove, 2);
});
test("update board confirmed constraint change sends only provided keys, never columns, and surfaces removed count", async () => {
  const { result } = await scripted("update_board", { board_id: 7, category_ids: [], confirm_card_removal: true }, [getStep(), tagStep("roadmap"), ["POST", `${p}/constraint-preview.json`, { cards_to_remove: 2 }, { category_ids: [], tag_names: ["roadmap"] }], ["PUT", `${p}.json`, { board: rawBoard({ category_ids: [], acl }), cards_removed_count: 2 }, { board: { category_ids: [] } }]]);
  const data = assertStructured(result);
  assert.equal(data.cards_removed_count, 2);
  assert.equal(data.board.columns, undefined);
});
test("update board tag-only preview includes unchanged current categories and guard checks only new tags", async () => {
  const { result } = await scripted("update_board", { board_id: 7, tag_names: ["roadmap", "todo"] }, [getStep(), tagStep("roadmap"), tagStep("todo"), ["POST", `${p}/constraint-preview.json`, { cards_to_remove: 0 }, { category_ids: [4], tag_names: ["roadmap", "todo"] }], ["PUT", `${p}.json`, { board: rawBoard() }, { board: { tag_names: ["roadmap", "todo"] } }]]);
  assert.equal(assertStructured(result).cards_removed_count, 0);
});
test("update board clearing all tags sends [] without tag lookup and previews complete constraints", async () => {
  const { result } = await scripted("update_board", { board_id: 7, tag_names: [] }, [getStep(), ["POST", `${p}/constraint-preview.json`, { cards_to_remove: 0 }, { category_ids: [4], tag_names: [] }], ["PUT", `${p}.json`, { board: rawBoard({ tag_names: [] }) }, { board: { tag_names: [] } }]]);
  assertStructured(result);
});
test("update board changed ACL needs confirm_access_change with current/requested policy", async () => {
  const { result } = await scripted("update_board", { board_id: 7, acl: [{ type: "group", name: "logged_in_users", permission: "view" }] }, [getStep()]);
  const error = assertError(result, "confirmation_required");
  assert.equal(error.current_acl.length, 2);
  assert.deepEqual(error.requested_acl, [{ type: "group", id: 5, permission: "view", name: "logged_in_users" }]);
});
test("update board confirmed ACL replacement maps IDs and sends no confirmation/helper fields", async () => {
  const { result } = await scripted("update_board", { board_id: 7, acl: [{ type: "group", name: "staff", permission: "edit" }], confirm_access_change: true }, [getStep(), ["PUT", `${p}.json`, { board: rawBoard({ acl }) }, { board: { acl: [{ type: "group", id: 3, permission: "edit" }] } }]]);
  assertStructured(result);
});
test("update unchanged ACL ignores mandatory admins and owner entries; provided equal keys are still sent with other changes", async () => {
  const { result } = await scripted("update_board", { board_id: 7, name: "Updated", show_tags: false, acl: [{ type: "group", name: "admins", permission: "manage" }] }, [getStep(), ["PUT", `${p}.json`, { board: rawBoard({ name: "Updated", acl }) }, { board: { name: "Updated", show_tags: false, acl: [{ type: "group", id: 1, permission: "manage" }] } }]]);
  assert.equal(assertStructured(result).cards_removed_count, 0);
});
test("update board ACL comparison is set-based and ignores duplicate resolved entries", async () => {
  const currentAcl = [...acl, { type: "group", id: 5, permission: "view", mandatory: false, display_name: "logged_in_users" }];
  const { result } = await scripted("update_board", { board_id: 7, acl: [{ type: "group", id: 5, permission: "view" }, { type: "group", name: "logged_in_users", permission: "view" }] }, [getStep(show({ acl: currentAcl }))]);
  assertError(result, "no_op");
});
test("update owner replacement requires access confirmation, resolves usernames before PUT", async () => {
  const denied = await scripted("update_board", { board_id: 7, owners: ["alice"] }, [getStep(), ["GET", "/u/alice.json?skip_track_visit=true", { user: { id: 9, username: "alice" } }]]);
  assertError(denied.result, "confirmation_required");
  const accepted = await scripted("update_board", { board_id: 7, owners: ["alice"], confirm_access_change: true }, [getStep(), ["GET", "/u/alice.json?skip_track_visit=true", { user: { id: 9, username: "alice" } }], ["PUT", `${p}.json`, { board: rawBoard() }, { board: { owner_user_ids: [9] } }]]);
  assertStructured(accepted.result);
});
for (const fields of [{ name: "Roadmap" }, { category_ids: [4], tag_names: ["ROADMAP"] }, { acl: [] }]) {
  test("update board equal scalar/constraint/ACL values are no-op without PUT or preview", async () => {
    const { result } = await scripted("update_board", { board_id: 7, ...fields }, [getStep(), ...("tag_names" in fields ? [tagStep("ROADMAP", "roadmap")] : [])]);
    assertError(result, "no_op");
  });
}
test("update board unchanged owner list is no-op without confirmation", async () => {
  const { result } = await scripted("update_board", { board_id: 7, owners: ["sam"] }, [getStep(), ["GET", "/u/sam.json?skip_track_visit=true", { user: { id: 1, username: "sam" } }]]);
  assertError(result, "no_op");
});
for (const [fixture, code] of [[show({ can_manage: false }), "board_not_manageable"], [show({ archived: true }), "board_archived"]] as const) {
  test(`board management rejects ${code} before PUT`, async () => {
    const { result } = await scripted("update_board", { board_id: 7, name: "X" }, [getStep(fixture)]);
    assertError(result, code);
  });
}
test("archive sends POST archive with exact empty body", async () => {
  const { result } = await scripted("set_board_archived", { board_id: 7, archived: true }, [getStep(), ["POST", `${p}/archive.json`, { board: rawBoard({ archived: true, slug: "roadmap-archived-20261109" }) }, {}]]);
  assert.equal(assertStructured(result).board.archived, true);
});
test("unarchive taken old slug requires explicit replacement without mutation", async () => {
  const fixture = show({ archived: true, can_unarchive: true, old_slug_used: true });
  assertError((await scripted("set_board_archived", { board_id: 7, archived: false }, [getStep(fixture)])).result, "slug_required");
  const { result } = await scripted("set_board_archived", { board_id: 7, archived: false, slug: "new-roadmap" }, [getStep(fixture), ["POST", `${p}/unarchive.json`, { board: rawBoard({ slug: "new-roadmap" }) }, { slug: "new-roadmap" }]]);
  assert.equal(assertStructured(result).board.slug, "new-roadmap");
});
test("unarchive omits slug when not needed and no-op avoids POST", async () => {
  const { result } = await scripted("set_board_archived", { board_id: 7, archived: false }, [getStep(show({ archived: true, can_unarchive: true })), ["POST", `${p}/unarchive.json`, { board: rawBoard() }, {}]]);
  assertStructured(result);
  assertError((await scripted("set_board_archived", { board_id: 7, archived: false }, [getStep()])).result, "no_op");
});
test("archive rejects slug and permission errors before POST", async () => {
  assertError((await scripted("set_board_archived", { board_id: 7, archived: true, slug: "X" }, [])).result);
  assertError((await scripted("set_board_archived", { board_id: 7, archived: true }, [getStep(show({ can_archive: false }))])).result, "insufficient_permission");
  assertError((await scripted("set_board_archived", { board_id: 7, archived: false }, [getStep(show({ archived: true, can_unarchive: false }))])).result, "insufficient_permission");
});
test("delete board verifies absence by DELETE then GET 404 and returns visible impact", async () => {
  const { result } = await scripted("delete_board", { board_id: 7, name: "Roadmap", confirm_delete: true }, [getStep(), ["DELETE", `${p}.json`, undefined, undefined, 204], ["GET", `${p}.json`, { errors: ["Board not found"], error_type: "not_found" }, undefined, 404]]);
  assert.deepEqual(assertStructured(result), { deleted: true, board: { id: 7, name: "Roadmap", slug: "roadmap" }, impact: { columns: 3, visible_cards: 2, topic_cards: 1, floater_cards: 1 } });
});
for (const status of [200, 403]) {
  test(`delete board verification GET ${status} cannot prove absence and returns outcome_unknown`, async () => {
    const { result } = await scripted("delete_board", { board_id: 7, name: "Roadmap", confirm_delete: true }, [getStep(), ["DELETE", `${p}.json`, undefined, undefined, 204], ["GET", `${p}.json`, show(), undefined, status]]);
    assertError(result, "outcome_unknown");
  });
}
test("delete board exact-name, archived and literal confirmation guards send no DELETE", async () => {
  const wrong = await scripted("delete_board", { board_id: 7, name: "roadmap", confirm_delete: true }, [getStep()]);
  assert.equal(assertError(wrong.result, "identity_mismatch").current_name, "Roadmap");
  assertError((await scripted("delete_board", { board_id: 7, name: "Roadmap", confirm_delete: true }, [getStep(show({ archived: true }))])).result, "board_archived");
  assertError((await scripted("delete_board", { board_id: 7, name: "Roadmap" }, [])).result);
  assertError((await scripted("delete_board", { board_id: 7, name: "Roadmap", confirm_delete: false }, [])).result);
});

const writeInputs: Record<string, Record<string, unknown>> = {
  create_board_card: { board_id: 7, column_id: 21, title: "X" },
  move_board_card: moveFirst,
  update_board_card: { board_id: 7, card_id: 102, title: "X" },
  delete_board_card: { board_id: 7, card_id: 102 },
  create_board_column: { board_id: 7, title: "X" },
  update_board_column: { board_id: 7, column_id: 21, title: "X" },
  move_board_column: { board_id: 7, column_id: 21, to_position: 1 },
  clear_board_column: { board_id: 7, column_id: 21, confirm_clear: true },
  delete_board_column: { board_id: 7, column_id: 21, column_title: "Todo", confirm_delete: true },
  create_board: { name: "New", acl: [] },
  update_board: { board_id: 7, name: "New" },
  set_board_archived: { board_id: 7, archived: true },
  delete_board: { board_id: 7, name: "Roadmap", confirm_delete: true },
};
for (const [name, input] of Object.entries(writeInputs)) {
  test(`${name} enforces write mode and auth before any HTTP`, async () => {
    const readOnly = await scripted(name, input, [], true, false);
    assert.match(assertError(readOnly.result).error, /Writes are disabled/);
    const anonymous = await scripted(name, input, [], false, true);
    assert.match(assertError(anonymous.result).error, /No auth configured/);
  });
}
for (const [status, code] of [[400, "invalid_parameters"], [401, "authentication_required"], [403, "insufficient_permission"], [404, "boards_unavailable_or_not_found"], [409, "conflict"], [422, "rejected"], [429, "rate_limited"], [418, "upstream_error"]] as const) {
  test(`boardsError maps HTTP ${status}, caps upstream errors and keeps error_type`, () => {
    const error = assertError(boardsError("Action", new HttpError(status, "reason", { errors: Array.from({ length: 25 }, (_, i) => `error ${i}`), error_type: "kind" })), code);
    assert.equal(error.status, status);
    assert.equal(error.errors.length, 20);
    assert.equal(error.error_type, "kind");
    assert.equal(error.error, "Action: reason");
  });
}
test("boardsError parses retry-after seconds, handles opaque 422 and non-HTTP preflight failure", () => {
  const limited = assertError(boardsError("Action", new HttpError(429, "slow", { errors: ["Please retry after 18 seconds"] })), "rate_limited");
  assert.equal(limited.retryable, true);
  assert.equal(limited.retry_after_seconds, 18);
  assertError(boardsError("Action", new HttpError(422, "bad", { failed: "FAILED" })), "rejected_without_details");
  assertError(boardsError("Action", new Error("offline")), "request_failed");
});
test("local preflight network failure is request_failed, not outcome_unknown", async () => {
  const { result } = await scripted("create_board_card", { board_id: 7, column_id: 21, topic_id: 55 }, [["PUT", `${p}/check-constraint-mismatches.json`, new Error("offline"), { topic_id: 55, target_column_id: 21 }]]);
  assertError(result, "request_failed");
});
test("malformed upstream mutation success is never emitted as structured success or input validation error", async () => {
  const { result } = await scripted("create_board_card", { board_id: 7, column_id: 21, title: "X" }, [["POST", `${p}/cards.json`, { card: { id: "invalid" } }, { card: { column_id: 21, title: "X" } }]]);
  assertError(result, "malformed_upstream_response");
});
test("real MCP client/server round trip validates Boards output schema and matching JSON fallback", async () => {
  const api = harness(false, false);
  const server = new McpServer({ name: "boards-test", version: "1.0.0" });
  api.ctx.server = server;
  registerToolDefinitions(boardTools, api.ctx, api.opts);
  const client = new Client({ name: "boards-test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mock = mockFetch(() => Response.json(show()));
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map((tool) => tool.name), toolNames.slice(0, 3));
    assert.ok(tools.tools.every((tool) => tool.outputSchema));
    const result = await client.callTool({ name: "discourse_get_board", arguments: { board_id: 7 } });
    const data = assertStructured(result);
    assert.equal(data.board.id, 7);
    assert.equal(data.columns[0].cards.length, 2);
    assert.equal(mock.requests.length, 1);
    assert.equal(mock.requests[0].url, `${api.base}${p}.json`);
    assert.equal(mock.requests[0].method, "GET");
  } finally {
    mock.restore();
    await client.close();
    await server.close();
  }
});

const failureMutations: Record<string, { preflight: Step[]; method: string; path: string; payload?: unknown }> = {
  create_board_card: { preflight: [], method: "POST", path: `${p}/cards.json`, payload: { card: { column_id: 21, title: "X" } } },
  move_board_card: { preflight: [getStep()], method: "PUT", path: `${p}/cards/102.json`, payload: { card: { column_id: 21, after_card_id: null } } },
  update_board_card: { preflight: [getStep()], method: "PUT", path: `${p}/cards/102.json`, payload: { card: { title: "X" } } },
  delete_board_card: { preflight: [getStep()], method: "DELETE", path: `${p}/cards/102.json` },
  create_board_column: { preflight: [], method: "POST", path: `${p}/columns.json`, payload: { column: { title: "X" } } },
  update_board_column: { preflight: [getStep()], method: "PUT", path: `${p}/columns/21.json`, payload: { column: { title: "X", icon: "list", color: "e45735", default_sort: "priority", tag_name: "todo", move_to_category_id: null, move_to_assigned: null, move_to_status: "open" } } },
  move_board_column: { preflight: [getStep()], method: "POST", path: `${p}/move-column.json`, payload: { column_id: 21, direction: 1 } },
  clear_board_column: { preflight: [getStep()], method: "DELETE", path: `${p}/columns/21/cards.json` },
  delete_board_column: { preflight: [getStep()], method: "DELETE", path: `${p}/columns/21.json` },
  create_board: { preflight: [], method: "POST", path: "/boards/api/boards.json", payload: createBody() },
  update_board: { preflight: [getStep()], method: "PUT", path: `${p}.json`, payload: { board: { name: "New" } } },
  set_board_archived: { preflight: [getStep()], method: "POST", path: `${p}/archive.json`, payload: {} },
  delete_board: { preflight: [getStep()], method: "DELETE", path: `${p}.json` },
};
for (const [name, wire] of Object.entries(failureMutations)) {
  test(`${name} sends exactly one mutation on 503, never retries or claims structured success`, async () => {
    const { result } = await scripted(name, writeInputs[name], [...wire.preflight, [wire.method, wire.path, { errors: ["Unavailable"] }, wire.payload, 503]]);
    const error = assertError(result, "outcome_unknown");
    assert.equal(error.retryable, false);
    assert.equal(error.board_id, name === "create_board" ? undefined : 7);
    if (name === "create_board") assert.equal("board_id" in error, false);
  });
}
test("move column malformed second acknowledgement counts the accepted swap and last confirmed order", async () => {
  const { result } = await scripted("move_board_column", { board_id: 7, column_id: 21, to_position: 2 }, [getStep(), ["POST", `${p}/move-column.json`, { column_order: [22, 21, 23] }, { column_id: 21, direction: 1 }], ["POST", `${p}/move-column.json`, {}, { column_id: 21, direction: 1 }]]);
  const error = assertError(result, "outcome_unknown");
  assert.equal(error.completed_swaps, 2);
  assert.deepEqual(error.column_order, [22, 21, 23]);
  assert.equal(error.retryable, false);
});
test("move column first network failure reports zero swaps and original order", async () => {
  const { result } = await scripted("move_board_column", { board_id: 7, column_id: 21, to_position: 1 }, [getStep(), ["POST", `${p}/move-column.json`, new Error("offline"), { column_id: 21, direction: 1 }]]);
  const error = assertError(result, "outcome_unknown");
  assert.equal(error.completed_swaps, 0);
  assert.deepEqual(error.column_order, [21, 22, 23]);
});
test("all tool input schemas are strict and validate before write/auth access checks", async () => {
  for (const tool of boardTools) {
    const name = tool.name.replace(/^discourse_/, "");
    const input = writeInputs[name] ?? (name === "list_boards" ? {} : name === "get_board" ? { board_id: 7 } : { topic_id: 55 });
    const { result } = await scripted(name, { ...input, unexpected: true }, [], false, false);
    assert.match(assertError(result).error, /[Vv]alidation/);
  }
});
test("read schemas enforce unique IDs, bounds and trimmed nonempty query without HTTP", async () => {
  for (const input of [{ board_id: 7, column_ids: [21, 21] }, { board_id: 7, card_ids: [101, 101] }, { board_id: 7, max_cards_per_column: 201 }, { board_id: 7, notes_max_chars: -1 }, { board_id: 7, card_query: " " }]) {
    assertError((await scripted("get_board", input, [])).result);
  }
});
test("normalization defaults optional/display fields but keeps essential board and column data", async () => {
  const raw = { id: 7, unicode_name: "Roadmap", slug: "roadmap", columns: [{ id: 21, title: "Todo" }] };
  const { result } = await scripted("list_boards", {}, [["GET", "/boards/api/boards.json?allowed_permissions=view,edit,manage", { boards: [raw] }]]);
  const board = assertStructured(result).boards[0];
  assert.equal(board.name, "Roadmap");
  assert.equal(board.archived, false);
  assert.equal(board.can_write, false);
  assert.deepEqual(board.owners, []);
  assert.deepEqual(board.category_ids, []);
  assert.deepEqual(board.columns[0], { id: 21, title: "Todo", position: 0, icon: null, color: null, default_sort: "priority", tag_name: null, move_to_category_id: null, move_to_assigned: null, move_to_status: null });
});
test("tag guard HTTP failures use board error mapping before any mutation", async () => {
  const { result } = await scripted("create_board_card", { board_id: 7, column_id: 21, title: "X", tag_names: ["todo"] }, [["GET", "/tags/filter/search.json?q=todo&limit=5", { errors: ["No access"] }, undefined, 403]]);
  assert.deepEqual(assertError(result, "insufficient_permission").errors, ["No access"]);
});
test("topic cross-column move on a board without confirmation does not require confirm_move", async () => {
  const { result } = await scripted("move_board_card", { board_id: 7, card_id: 101, to_column_id: 22, constraint_fix: { category_id: 4 } }, [getStep(show({ require_confirmation: false })), preflight(constraintsOk, 55, 22), ["PUT", `${p}/cards/101.json`, { card: topicCard({ column_id: 22 }) }, { card: { column_id: 22 } }]]);
  assert.deepEqual(assertStructured(result).warnings, ["constraint_fix ignored: the topic already matches the board constraints"]);
});
test("promotion without adoption sends topic_id only and normalizes missing adopted ID to null", async () => {
  const { result } = await scripted("update_board_card", { board_id: 7, card_id: 102, promote_to_topic_id: 55, confirm_promotion: true }, [getStep(), preflight(), ["PUT", `${p}/cards/102.json`, { card: topicCard({ id: 102 }), adopted_floater_id: null }, { card: { topic_id: 55 } }]]);
  assert.equal(assertStructured(result).adopted_floater_id, null);
});

test("real MCP write-mode discovery exposes all 16 schemas and validates transformed column color input", async () => {
  const api = harness();
  const server = new McpServer({ name: "boards-write-test", version: "1.0.0" });
  api.ctx.server = server;
  registerToolDefinitions(boardTools, api.ctx, api.opts);
  const client = new Client({ name: "boards-write-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mock = mockFetch((_request, index) => Response.json(index === 0 ? { column: { ...columns[0], tag_name: null } } : show()));
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name), toolNames);
    assert.ok(listed.tools.every((tool) => tool.outputSchema));
    const result = await client.callTool({ name: "discourse_create_board_column", arguments: { board_id: 7, title: "Todo", color: "#abc" } });
    assert.equal(assertStructured(result).column.total_card_count, 2);
    assert.equal(mock.requests.length, 2);
    assert.equal(mock.requests[0].method, "POST");
    assert.equal(mock.requests[0].url, `${api.base}${p}/columns.json`);
    assert.deepEqual(await mock.requests[0].json(), { column: { title: "Todo", color: "abc" } });
    assert.equal(mock.requests[1].method, "GET");
    assert.equal(mock.requests[1].url, `${api.base}${p}.json`);
  } finally {
    mock.restore();
    await client.close();
    await server.close();
  }
});

// Section 10 review amendments: R1–R13.
const systemOwners = [{ id: -1, username: "system", name: "System" }];
const systemAcl = [acl[0], { type: "user", id: -1, permission: "owner", mandatory: false, display_name: "System", username: "system" }];
const userStep = (username: string, id: number): Step => ["GET", `/u/${encodeURIComponent(username)}.json?skip_track_visit=true`, { user: { id, username } }];

test("R1: system-owned boards do not break list or get and retain the system ACL owner", async () => {
  const listed = await scripted("list_boards", {}, [["GET", "/boards/api/boards.json?allowed_permissions=view,edit,manage", { boards: [rawBoard(), rawBoard({ id: 8, owners: systemOwners })] }]]);
  assert.deepEqual(assertStructured(listed.result).boards[1].owners, systemOwners);
  const detail = await scripted("get_board", { board_id: 7 }, [getStep(show({ owners: systemOwners, acl: systemAcl }))]);
  const board = assertStructured(detail.result).board;
  assert.deepEqual(board.owners, systemOwners);
  assert.deepEqual(board.acl[1], { type: "user", id: -1, permission: "owner", mandatory: false, display_name: "System", username: "system" });
});
test("R1: ACL comparison ignores a system owner and does not demand access confirmation", async () => {
  const { result } = await scripted("update_board", { board_id: 7, name: "Changed", acl: [] }, [getStep(show({ owners: systemOwners, acl: systemAcl })), ["PUT", `${p}.json`, { board: rawBoard({ name: "Changed", owners: systemOwners, acl: systemAcl }) }, { board: { name: "Changed", acl: [] } }]]);
  assert.deepEqual(assertStructured(result).board.owners, systemOwners);
});
test("R1/R5: system resolves as an additional owner; requested and effective owners remain distinct", async () => {
  const effectiveOwners = [...rawBoard().owners, ...systemOwners];
  const { result } = await scripted("create_board", { name: "New", acl: [], owners: ["system"] }, [userStep("system", -1), ["POST", "/boards/api/boards.json", { board: rawBoard({ owners: effectiveOwners }) }, createBody({ owner_user_ids: [-1] })]]);
  const data = assertStructured(result);
  assert.deepEqual(data.owners_requested, [{ id: -1, username: "system" }]);
  assert.deepEqual(data.board.owners, effectiveOwners.map(({ id, username, name }) => ({ id, username, name })));
  assert.equal("owners_applied" in data, false);
});
test("R1: system user cannot resolve to a non-owner ACL entry", async () => {
  const { result } = await scripted("create_board", { name: "New", acl: [{ type: "user", name: "system", permission: "view" }] }, [userStep("system", -1)]);
  assert.equal(assertError(result, "invalid_acl_entry").entry.id, -1);
});
for (const overrides of [{ owners: [{ id: -2, username: "bad" }] }, { owners: [{ id: 0, username: "bad" }] }, { acl: [{ type: "group", id: -1, permission: "manage" }] }]) {
  test("R1: accepting the system owner does not permit other invalid owner or negative group IDs", async () => {
    assertError((await scripted("get_board", { board_id: 7 }, [getStep(show(overrides))])).result, "malformed_upstream_response");
  });
}
test("R1/R6: an unchanged system owner is omitted from a scalar update even without owner-management rights", async () => {
  const { result } = await scripted("update_board", { board_id: 7, name: "Changed", owners: ["system"] }, [getStep(show({ owners: systemOwners, acl: systemAcl, can_manage_acl_owner: false })), userStep("system", -1), ["PUT", `${p}.json`, { board: rawBoard({ name: "Changed", owners: systemOwners, acl: systemAcl }) }, { board: { name: "Changed" } }]]);
  assertStructured(result);
});

test("R2: visible unused tags pass the guard without allowing tag creation", async () => {
  const { result } = await scripted("create_board_card", { board_id: 7, column_id: 21, title: "X", tag_names: ["unused"] }, [tagStep("unused"), ["POST", `${p}/cards.json`, { card: floaterCard() }, { card: { column_id: 21, title: "X", tag_names: ["unused"] } }]]);
  assertStructured(result);
});
test("R2: exact case-insensitive tag match is selected, not a substring result; queries are encoded and deduped", async () => {
  const input = { board_id: 7, column_id: 21, title: "X", tag_names: ["To Do&", "to do&"] };
  const { result } = await scripted("create_board_card", input, [["GET", "/tags/filter/search.json?q=to%20do%26&limit=5", { results: [{ id: 30, name: "prefix-to do&" }, { id: 31, name: "To Do&", count: 0 }] }], ["POST", `${p}/cards.json`, { card: floaterCard() }, { card: { column_id: 21, title: "X", tag_names: input.tag_names } }]]);
  assertStructured(result);
});
test("R2: substring-only search results remain missing and the guard lists missing_tags", async () => {
  const { result } = await scripted("create_board_card", { board_id: 7, column_id: 21, title: "X", tag_names: ["todo", "missing"] }, [["GET", "/tags/filter/search.json?q=todo&limit=5", { results: [{ id: 31, name: "todo-later" }] }], tagStep("missing", null)]);
  assert.deepEqual(assertError(result, "tag_creation_not_allowed").missing_tags, ["todo", "missing"]);
});
for (const response of [{}, { results: null }, { results: {} }, { results: [{}] }, { results: [{ name: 42 }] }]) {
  test("R2: malformed search data fails before any mutation with ordinary malformed_upstream_response", async () => {
    const { result } = await scripted("create_board_column", { board_id: 7, title: "New", tag_name: "todo" }, [["GET", "/tags/filter/search.json?q=todo&limit=5", response]]);
    const error = assertError(result, "malformed_upstream_response");
    assert.equal("mutation_applied" in error, false);
  });
}

test("R3: case-mismatched tags are canonicalized for both constraint preview and update", async () => {
  const { result } = await scripted("update_board", { board_id: 7, category_ids: [9], tag_names: ["Roadmap"] }, [getStep(), tagStep("Roadmap", "roadmap"), ["POST", `${p}/constraint-preview.json`, { cards_to_remove: 0 }, { category_ids: [9], tag_names: ["roadmap"] }], ["PUT", `${p}.json`, { board: rawBoard({ category_ids: [9] }) }, { board: { category_ids: [9], tag_names: ["roadmap"] } }]]);
  assertStructured(result);
});
test("R3: all-new resulting tags require confirmation without a preview, including hidden-card warning", async () => {
  const { result } = await scripted("update_board", { board_id: 7, tag_names: ["BrandNew"], allow_tag_creation: true }, [getStep(), tagStep("BrandNew", null)]);
  const error = assertError(result, "confirmation_required");
  assert.equal(error.visible_topic_cards, 1);
  assert.match(error.error, /hidden topic cards/);
});
test("R3: all-new tags still require confirmation when no topic cards are visible", async () => {
  const { result } = await scripted("update_board", { board_id: 7, tag_names: ["BrandNew"], allow_tag_creation: true }, [getStep(show({}, [[floaterCard()]])), tagStep("BrandNew", null)]);
  assert.equal(assertError(result, "confirmation_required").visible_topic_cards, 0);
});
test("R3: confirmed all-new constraints skip preview and preserve caller spelling in the PUT", async () => {
  const { result } = await scripted("update_board", { board_id: 7, tag_names: ["BrandNew"], allow_tag_creation: true, confirm_card_removal: true }, [getStep(), tagStep("BrandNew", null), ["PUT", `${p}.json`, { board: rawBoard({ tag_names: ["BrandNew"] }), cards_removed_count: 1 }, { board: { tag_names: ["BrandNew"] } }]]);
  assert.equal(assertStructured(result).cards_removed_count, 1);
});
test("R3: removal confirmation does not silently authorize creation of missing tags", async () => {
  const { result } = await scripted("update_board", { board_id: 7, tag_names: ["BrandNew"], confirm_card_removal: true }, [getStep(), tagStep("BrandNew", null)]);
  assert.deepEqual(assertError(result, "tag_creation_not_allowed").missing_tags, ["BrandNew"]);
});
test("R3: mixed existing and new constraints preview existing tags only and resolve them once", async () => {
  const { result } = await scripted("update_board", { board_id: 7, tag_names: ["ROADMAP", "NewTag"], allow_tag_creation: true }, [getStep(), tagStep("ROADMAP", "roadmap"), tagStep("NewTag", null), ["POST", `${p}/constraint-preview.json`, { cards_to_remove: 0 }, { category_ids: [4], tag_names: ["roadmap"] }], ["PUT", `${p}.json`, { board: rawBoard({ tag_names: ["roadmap", "NewTag"] }) }, { board: { tag_names: ["roadmap", "NewTag"] } }]]);
  assertStructured(result);
});

type RepairTool = "create_board_card" | "move_board_card" | "update_board_card";
function repairFlow(tool: RepairTool) {
  if (tool === "create_board_card") return { input: { board_id: 7, column_id: 21, topic_id: 55 }, before: [] as Step[], target: 21, method: "POST", path: `${p}/cards.json`, card: { column_id: 21, topic_id: 55 } };
  if (tool === "move_board_card") return { input: { board_id: 7, card_id: 101, to_column_id: 22, confirm_move: true }, before: [getStep(show({ category_ids: [4, 9] }))], target: 22, method: "PUT", path: `${p}/cards/101.json`, card: { column_id: 22 } };
  return { input: { board_id: 7, card_id: 102, promote_to_topic_id: 55, confirm_promotion: true }, before: [getStep()], target: 21, method: "PUT", path: `${p}/cards/102.json`, card: { topic_id: 55 } };
}
const repairCases = [
  { name: "missing category", result: constraintsMismatch, fix: { tag_names: ["roadmap"] }, code: "incomplete_constraint_fix" },
  { name: "invalid category", result: constraintsMismatch, fix: { category_id: 8, tag_names: ["roadmap"] }, code: "invalid_constraint_fix" },
  { name: "missing tags", result: constraintsMismatch, fix: { category_id: 4 }, code: "incomplete_constraint_fix" },
  { name: "empty tags", result: constraintsMismatch, fix: { category_id: 4, tag_names: [] }, code: "incomplete_constraint_fix" },
  { name: "invalid tag among valid ones", result: constraintsMismatch, fix: { category_id: 4, tag_names: ["roadmap", "wrong"] }, code: "invalid_constraint_fix" },
  { name: "canonical tag spelling", result: { ...constraintsMismatch, tags_needed: ["Roadmap"] }, fix: { category_id: 4, tag_names: ["ROADMAP"] }, sent: { category_id: 4, tag_names: ["Roadmap"] } },
  { name: "unnecessary category dropped", result: { ...constraintsMismatch, categories_needed: [] }, fix: { category_id: 4, tag_names: ["ROADMAP"] }, sent: { tag_names: ["roadmap"] }, warning: /category_id ignored/ },
  { name: "unnecessary tags dropped", result: { ...constraintsMismatch, tags_needed: [] }, fix: { category_id: 4, tag_names: ["irrelevant"] }, sent: { category_id: 4 }, warning: /tag_names ignored/ },
] as const;
for (const tool of ["create_board_card", "move_board_card", "update_board_card"] as const) {
  for (const item of repairCases) {
    test(`R4: ${tool} validates ${item.name} before dispatch`, async () => {
      const flow = repairFlow(tool);
      const steps: Step[] = [...flow.before, preflight(item.result, 55, flow.target)];
      if ("sent" in item) steps.push([flow.method, flow.path, { card: topicCard() }, { card: flow.card, constraint_fix: item.sent }]);
      const { result } = await scripted(tool, { ...flow.input, constraint_fix: item.fix }, steps);
      if ("code" in item) assertError(result, item.code);
      else {
        const data = assertStructured(result);
        if ("warning" in item) assert.match(data.warnings[0], item.warning);
      }
    });
  }
  test(`R4: ${tool} keeps mismatch-without-fix unstructured and sends no mutation`, async () => {
    const flow = repairFlow(tool);
    const { result } = await scripted(tool, flow.input, [...flow.before, preflight(constraintsMismatch, 55, flow.target)]);
    assertError(result, "constraint_mismatch");
  });
  test(`R4: ${tool} drops an unnecessary complete fix without sending topic edits`, async () => {
    const flow = repairFlow(tool);
    const { result } = await scripted(tool, { ...flow.input, constraint_fix: { category_id: 4, tag_names: ["roadmap"] } }, [...flow.before, preflight(constraintsOk, 55, flow.target), [flow.method, flow.path, { card: topicCard() }, { card: flow.card }]]);
    assert.deepEqual(assertStructured(result).warnings, ["constraint_fix ignored: the topic already matches the board constraints"]);
  });
}
for (const tool of ["move_board_card", "update_board_card"] as const) {
  test(`R4: ${tool} rejects an unfixable target-column category rule without mutation`, async () => {
    const input = tool === "move_board_card" ? { board_id: 7, card_id: 101, to_column_id: 22, confirm_move: true } : { board_id: 7, card_id: 102, promote_to_topic_id: 55, confirm_promotion: true };
    const fixture = tool === "move_board_card" ? show() : show({}, [[], [floaterCard({ column_id: 22 })]]);
    const { result } = await scripted(tool, { ...input, constraint_fix: { category_id: 4, tag_names: ["roadmap"] } }, [getStep(fixture), preflight(constraintsMismatch, 55, 22)]);
    const error = assertError(result, "unfixable_constraint_mismatch");
    assert.equal(error.move_to_category_id, 9);
    assert.equal("mutation_applied" in error, false);
  });
}

test("R5/R11: descriptions disclose additive creation owners, promotion placement and pruning on any board update", () => {
  const description = (name: string) => boardTools.find((tool) => tool.name === `discourse_${name}`)!.description;
  assert.match(description("create_board"), /always becomes an owner/);
  assert.match(description("create_board"), /owners ADDS owners/);
  assert.match(description("create_board"), /owners_requested/);
  assert.match(description("update_board_card"), /end of its column/);
  assert.match(description("update_board"), /ANY board update may prune/);
  assert.match(description("update_board"), /cards_removed_count/);
});
test("R6: unchanged ordinary owners are omitted when updating other fields without owner-management rights", async () => {
  const { result } = await scripted("update_board", { board_id: 7, name: "Changed", owners: ["sam"] }, [getStep(show({ can_manage_acl_owner: false })), userStep("sam", 1), ["PUT", `${p}.json`, { board: rawBoard({ name: "Changed" }) }, { board: { name: "Changed" } }]]);
  assertStructured(result);
});
for (const confirmed of [true, false]) {
  test(`R6: changed owners need owner-management rights even when access confirmation is ${confirmed}`, async () => {
    const { result } = await scripted("update_board", { board_id: 7, owners: ["alice"], confirm_access_change: confirmed }, [getStep(show({ can_manage_acl_owner: false })), userStep("alice", 9)]);
    assert.match(assertError(result, "insufficient_permission").error, /can_manage_acl_owner/);
  });
}
test("R6: opaque board-update 422 explains owner, ACL, category, slug and tag causes", async () => {
  const { result } = await scripted("update_board", { board_id: 7, name: "Changed" }, [getStep(), ["PUT", `${p}.json`, { failed: "FAILED" }, { board: { name: "Changed" } }, 422]]);
  assert.deepEqual(assertError(result, "rejected_without_details").possible_causes, ["owner change not permitted", "invalid ACL entry", "unknown category", "slug in use", "tag cannot be resolved/created"]);
});
test("R7: a 403 includes disabled Boards among possible causes", () => {
  const error = assertError(boardsError("Action", new HttpError(403, "Forbidden")), "insufficient_permission");
  assert.ok(error.possible_causes.includes("boards plugin disabled (boards_enabled site setting)"));
});
for (const failure of [503, new Error("connection lost")]) {
  test("R8: uncertain board creation omits board_id and recovers by name through list_boards", async () => {
    const { result } = await scripted("create_board", { name: "A \"quoted\" Board", acl: [] }, [["POST", "/boards/api/boards.json", typeof failure === "number" ? {} : failure, createBody({ name: "A \"quoted\" Board" }), typeof failure === "number" ? failure : undefined]]);
    const error = assertError(result, "outcome_unknown");
    assert.equal("board_id" in error, false);
    assert.equal(error.retryable, false);
    assert.match(error.error, /discourse_list_boards/);
    assert.ok(error.error.includes(JSON.stringify({ query: "A \"quoted\" Board", include_archived: true })));
    assert.doesNotMatch(error.error, /discourse_get_board/);
  });
}

function assertAcceptedMalformed(result: any, create = false) {
  const error = assertError(result, "malformed_upstream_response");
  assert.equal(error.mutation_applied, true);
  assert.equal(error.retryable, false);
  assert.match(error.error, /Discourse accepted the request/);
  assert.match(error.error, /do not retry blindly/);
  assert.match(error.error, create ? /discourse_list_boards/ : /discourse_get_board/);
  if (create) assert.doesNotMatch(error.error, /discourse_get_board/);
  return error;
}
for (const name of ["create_board_card", "move_board_card", "update_board_card", "create_board_column", "create_board", "update_board", "set_board_archived"]) {
  test(`R9: ${name} reports accepted malformed 2xx response with no blind-retry advice`, async () => {
    const wire = failureMutations[name];
    const { result } = await scripted(name, writeInputs[name], [...wire.preflight, [wire.method, wire.path, {}, wire.payload]]);
    const error = assertAcceptedMalformed(result, name === "create_board");
    if (name === "create_board") assert.ok(error.error.includes(JSON.stringify({ query: "New", include_archived: true })));
  });
}
test("R9: update-column fallback marks an unreadable PUT acknowledgement as applied only after re-read fails", async () => {
  const wire = failureMutations.update_board_column;
  const { result } = await scripted("update_board_column", writeInputs.update_board_column, [getStep(), ["PUT", wire.path, {}, wire.payload], ["GET", `${p}.json`, {}, undefined, 403]]);
  assertAcceptedMalformed(result);
});
test("R9/declined: a successful authoritative re-read does not require a valid column PUT response", async () => {
  const wire = failureMutations.update_board_column;
  const fixture = show();
  fixture.columns[0].title = "X";
  const { result } = await scripted("update_board_column", writeInputs.update_board_column, [getStep(), ["PUT", wire.path, {}, wire.payload], getStep(fixture)]);
  assert.equal(assertStructured(result).column.title, "X");
});
test("R9: malformed output-only mutation metadata also carries the applied marker", async () => {
  const updated = await scripted("update_board", { board_id: 7, name: "Changed" }, [getStep(), ["PUT", `${p}.json`, { board: rawBoard({ name: "Changed" }), cards_removed_count: -1 }, { board: { name: "Changed" } }]]);
  assertAcceptedMalformed(updated.result);
  const card = await scripted("update_board_card", { board_id: 7, card_id: 102, title: "Changed" }, [getStep(), ["PUT", `${p}/cards/102.json`, { card: floaterCard(), adopted_floater_id: "bad" }, { card: { title: "Changed" } }]]);
  assertAcceptedMalformed(card.result);
});
test("R9: malformed preflight data is not marked as an accepted mutation", async () => {
  const { result } = await scripted("create_board_card", { board_id: 7, column_id: 21, topic_id: 55 }, [preflight({ constraints_need_fixing: true })]);
  const error = assertError(result, "malformed_upstream_response");
  assert.equal("mutation_applied" in error, false);
  assert.doesNotMatch(error.error, /accepted/);
});
test("R10: malformed first accepted swap counts one completed swap and retains the original order", async () => {
  const { result } = await scripted("move_board_column", { board_id: 7, column_id: 21, to_position: 2 }, [getStep(), ["POST", `${p}/move-column.json`, { column_order: "bad" }, { column_id: 21, direction: 1 }]]);
  const error = assertError(result, "outcome_unknown");
  assert.equal(error.completed_swaps, 1);
  assert.deepEqual(error.column_order, [21, 22, 23]);
  assert.equal(error.retryable, false);
});
test("R11: scalar-only updates can report pruning of stale cards on a constrained board", async () => {
  const { result } = await scripted("update_board", { board_id: 7, show_tags: true }, [getStep(), ["PUT", `${p}.json`, { board: rawBoard({ show_tags: true }), cards_removed_count: 2 }, { board: { show_tags: true } }]]);
  assert.equal(assertStructured(result).cards_removed_count, 2);
});
for (const [group, permission, rule, otherRule] of [["everyone", "view", /everyone/, /anonymous_users/], ["anonymous_users", "edit", /anonymous_users/, /everyone/]] as const) {
  test(`R11: banned ACL message identifies only the ${group} rule`, async () => {
    const { result } = await scripted("create_board", { name: "New", acl: [{ type: "group", name: group, permission }] }, []);
    const error = assertError(result, "banned_acl_entry");
    assert.match(error.error, rule);
    assert.doesNotMatch(error.error, otherRule);
  });
}
test("R12: create caches case-insensitive group/user lookups across ACL entries and owners", async () => {
  const input = { name: "New", acl: [{ type: "group", name: "designers", permission: "view" }, { type: "group", name: "DESIGNERS", permission: "edit" }, { type: "user", name: "alice", permission: "edit" }, { type: "user", name: "ALICE", permission: "manage" }], owners: ["ALICE", "alice"] };
  const { result } = await scripted("create_board", input, [["GET", "/groups/designers.json", { group: { id: 42, name: "designers" } }], userStep("alice", 9), ["POST", "/boards/api/boards.json", { board: rawBoard() }, createBody({ acl: [{ type: "group", id: 42, permission: "view" }, { type: "group", id: 42, permission: "edit" }, { type: "user", id: 9, permission: "edit" }, { type: "user", id: 9, permission: "manage" }], owner_user_ids: [9] })]]);
  assert.deepEqual(assertStructured(result).owners_requested, [{ id: 9, username: "ALICE" }]);
});
test("R12: update shares one visit-free user lookup between ACL and owners", async () => {
  const { result } = await scripted("update_board", { board_id: 7, acl: [{ type: "user", name: "Alice Smith", permission: "manage" }], owners: ["alice smith"], confirm_access_change: true }, [getStep(), userStep("Alice Smith", 9), ["PUT", `${p}.json`, { board: rawBoard() }, { board: { acl: [{ type: "user", id: 9, permission: "manage" }], owner_user_ids: [9] } }]]);
  assertStructured(result);
});
test("R12: principal cache is scoped to a call rather than retained by the site/client", async () => {
  const api = harness();
  const mock = mockFetch((request) => Response.json(request.url.includes("/u/") ? { user: { id: 9, username: "alice" } } : show()));
  try {
    for (let i = 0; i < 2; i++) {
      assertError(await api.invoke("update_board", { board_id: 7, owners: ["alice"] }), "confirmation_required");
    }
    assert.deepEqual(mock.requests.map((request) => new URL(request.url).pathname + new URL(request.url).search), [`${p}.json`, "/u/alice.json?skip_track_visit=true", `${p}.json`, "/u/alice.json?skip_track_visit=true"]);
    assert.ok(mock.requests.every((request) => request.method === "GET"));
  } finally { mock.restore(); }
});

for (const [tool, permissionField, denial] of [
  ["update_board_column", "can_manage", "board_not_manageable"],
  ["clear_board_column", "can_write", "board_not_writable"],
  ["delete_board_column", "can_manage", "board_not_manageable"],
  ["delete_board_card", "can_write", "board_not_writable"],
] as const) {
  for (const archived of [true, false]) {
    test(`R13: ${tool} ${archived ? "archived" : denial} guard sends exactly the fresh GET`, async () => {
      const fixture = show(archived ? { archived: true } : { [permissionField]: false });
      const { result } = await scripted(tool, writeInputs[tool], [getStep(fixture)]);
      assertError(result, archived ? "board_archived" : denial);
    });
  }
}
for (const [overrides, code] of [[{ archived: true }, "board_archived"], [{ can_write: false }, "board_not_writable"]] as const) {
  test(`R13: promotion on a ${code} board stops after one GET`, async () => {
    const { result } = await scripted("update_board_card", { board_id: 7, card_id: 102, promote_to_topic_id: 55, confirm_promotion: true }, [getStep(show(overrides))]);
    assertError(result, code);
  });
}
test("R13: column filtering counts selected columns only and does not report excluded cards as missing", async () => {
  const { result } = await scripted("get_board", { board_id: 7, column_ids: [22], card_ids: [101] }, [getStep(show({}, [[topicCard()], [floaterCard({ id: 103, column_id: 22 })]]))]);
  const data = assertStructured(result);
  assert.equal(data.columns.length, 1);
  assert.equal(data.columns[0].id, 22);
  assert.equal(data.columns[0].total_card_count, 1);
  assert.equal(data.columns[0].card_count, 0);
  assert.deepEqual(data.columns[0].cards, []);
  assert.deepEqual(data.meta, { total_cards: 1, matching_cards: 0, returned_cards: 0, truncated: false, max_cards_per_column: 50, missing_card_ids: [] });
  assert.match(boardTools[1].description, /selected columns only/);
  assert.equal(boardTools[1].annotations?.readOnlyHint, true);
});
