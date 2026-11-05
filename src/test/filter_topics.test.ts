import test from "node:test";
import assert from "node:assert/strict";
import { Logger } from "../util/logger.js";
import { SiteState } from "../site/state.js";
import { filterTopicsTool, projectTopic } from "../tools/builtin/filter_topics.js";
import { readTopicTool } from "../tools/builtin/read_topic.js";
import type { ToolContext, ToolRegistrationOptions } from "../tools/types.js";

function setup() {
  const logger = new Logger("silent");
  const siteState = new SiteState({ logger, timeoutMs: 5000, defaultAuth: { type: "none" } });
  siteState.selectSite("https://example.com");
  const ctx: ToolContext = { server: {} as any, siteState, logger, maxReadLength: 50000 };
  const opts: ToolRegistrationOptions = { allowWrites: false, toolsMode: "discourse_api_only" };
  return { ctx, opts };
}

async function invoke(input: Record<string, unknown>) {
  const { ctx, opts } = setup();
  return filterTopicsTool.handler(input as any, {} as any, ctx, opts);
}

function body(result: Awaited<ReturnType<typeof invoke>>): any {
  const content = result.content[0];
  return JSON.parse(content?.type === "text" ? content.text : "{}");
}

function mockFetch(payload: unknown) {
  const original = globalThis.fetch;
  const requests: Array<{ url: string; method: string }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), method: init?.method ?? "GET" });
    return Response.json(payload);
  };
  return { requests, restore: () => { globalThis.fetch = original; } };
}

test("topic discovery preserves filtered calls and routes top and hot exactly", async () => {
  const mock = mockFetch({ topic_list: { topics: [] } });
  try {
    await invoke({ filter: "category:support status:open", page: 2, per_page: 15 });
    await invoke({ view: "top", top_period: "monthly", page: 1, per_page: 25 });
    await invoke({ view: "top" });
    const hot = body(await invoke({ view: "hot" }));

    assert.deepEqual(mock.requests.map((r) => r.url), [
      "https://example.com/filter.json?q=category%3Asupport+status%3Aopen&page=2&per_page=15",
      "https://example.com/top.json?period=monthly&page=1&per_page=25",
      "https://example.com/top.json?period=weekly&page=0&per_page=20",
      "https://example.com/top.json?period=daily&page=0&per_page=20",
    ]);
    assert.equal(hot.meta.view, "hot");
    assert.equal(hot.meta.top_period, "daily");
  } finally {
    mock.restore();
  }
});

test("invalid topic discovery combinations fail before HTTP", async () => {
  const mock = mockFetch({});
  try {
    for (const input of [
      {},
      { filter: "   " },
      { view: "top", filter: "tag:x" },
      { view: "hot", top_period: "daily" },
      { filter: "tag:x", top_period: "weekly" },
    ]) {
      const result = await invoke(input);
      assert.equal(result.isError, true);
    }
    assert.equal(mock.requests.length, 0);
  } finally {
    mock.restore();
  }
});

test("topic discovery returns a uniform rich sparse-safe projection and truthful pagination", async () => {
  const rich = {
    id: 123, slug: "topic-slug", title: "Topic title", category_id: 4, tags: ["support"],
    created_at: "2026-08-01T10:00:00Z", last_posted_at: "2026-08-17T12:00:00Z", bumped_at: "2026-08-17T12:00:00Z",
    posts_count: 38, reply_count: 37, views: 2100, like_count: 45, posters_count: 14,
    closed: false, archived: false, pinned: false, visible: true,
    posters: [{ user_id: 8, username: "alice", description: "Most Recent Poster", plugin_value: "ignored" }],
    solved: true,
  };
  const mock = mockFetch({ topic_list: { topics: [rich, { id: 2 }], more_topics_url: "/latest?before=2", total_count: 9 } });
  try {
    const output = body(await invoke({ filter: "status:open", per_page: 1 }));
    assert.deepEqual(output.results, [projectTopic(rich)]);
    assert.deepEqual(output.results[0].posters[0], { user_id: 8, username: "alice", description: "Most Recent Poster" });
    assert.equal(output.results[0].last_poster_username, "alice");
    assert.equal("solved" in output.results[0], false);
    assert.deepEqual(output.meta, {
      view: "filtered", top_period: null, page: 0, per_page: 1, returned: 1, has_more: true, total: 9,
    });
    const sparse = projectTopic({ id: 2 });
    assert.equal(sparse.slug, null);
    assert.equal(sparse.posts_count, null);
    assert.equal(sparse.posters, null);
  } finally {
    mock.restore();
  }
});

test("topic discovery never treats a full page as proof of continuation", async () => {
  const mock = mockFetch({ topic_list: { topics: [{ id: 1 }] } });
  try {
    const output = body(await invoke({ filter: "status:open", per_page: 1 }));
    assert.equal(output.meta.has_more, false);
    assert.equal("total" in output.meta, false);
  } finally {
    mock.restore();
  }
});

test("topic discovery tolerates a malformed topic row", async () => {
  const mock = mockFetch({ topic_list: { topics: ["malformed"] } });
  try {
    const result = await invoke({ filter: "assigned:*" });
    const discovered = body(result).results[0];

    assert.equal(result.isError, undefined);
    assert.equal("assigned_to_user" in discovered, false);
    assert.equal("assignment_status" in discovered, false);
  } finally {
    mock.restore();
  }
});

test("topic discovery and reads preserve authorized assignment metadata", async () => {
  const assignments = [
    { assigned_to_user: { id: 8, username: "alice", name: "Alice" } },
    { assigned_to_group: { id: 4, name: "security", assignable_level: 1 } },
    { indirectly_assigned_to: { "12": { assigned_to: { id: 9, username: "bob" }, post_number: 3 } } },
    { assigned_to_user: { id: 8, username: "alice" }, assignment_note: "Follow up", assignment_status: "In Progress" },
    { assigned_to_user: null },
    {},
  ];

  for (const assignment of assignments) {
    const topic = {
      id: 123,
      posts_count: 1,
      post_stream: { posts: [{ id: 12, post_number: 1, raw: "Report" }] },
      ...assignment,
    };
    const mock = mockFetch({ ...topic, topic_list: { topics: [topic] } });
    try {
      const { ctx, opts } = setup();
      const discovered = body(await invoke({ filter: "assigned:*" })).results[0];
      const read = body(await readTopicTool.handler({ topic_id: 123, post_limit: 1 }, {} as any, ctx, opts));

      for (const result of [discovered, read]) {
        for (const field of ["assigned_to_user", "assigned_to_group", "indirectly_assigned_to", "assignment_note", "assignment_status"]) {
          assert.equal(field in result, field in assignment);
          if (field in assignment) {
            assert.deepEqual(result[field], assignment[field as keyof typeof assignment]);
          }
        }
      }
      assert.equal(mock.requests.length, 2);
    } finally {
      mock.restore();
    }
  }
});
