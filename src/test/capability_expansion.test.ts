import test from "node:test";

// Contracts verified against the local Discourse checkout (2026-08-18):
// config/routes.rb; topics_controller.rb; posts_controller.rb; search_controller.rb;
// user_actions_controller.rb; directory_items_controller.rb; groups_controller.rb;
// admin/reports_controller.rb; discourse-solved and discourse-ai plugin routes,
// controllers, serializers, and matching request specs. Fixtures below preserve
// the endpoint-specific roots and limits rather than assuming one generic API.

import assert from "node:assert/strict";
import { Logger } from "../util/logger.js";
import { SiteState } from "../site/state.js";
import { builtinTools } from "../tools/builtin/catalog.js";
import type { ToolContext, ToolRegistrationOptions } from "../tools/types.js";

function setup(authenticated = false) {
  const logger = new Logger("silent");
  const siteState = new SiteState({ logger, timeoutMs: 5_000, defaultAuth: authenticated ? { type: "api_key", key: "secret", username: "system" } : { type: "none" } });
  const { base } = siteState.buildClientForSite("https://example.com");
  siteState.selectSite(base);
  const ctx = { server: {} as any, siteState, logger, maxReadLength: 8 } satisfies ToolContext;
  const opts = { allowWrites: false, toolsMode: "discourse_api_only" } satisfies ToolRegistrationOptions;
  return { ctx, opts };
}

function body(result: any) { return JSON.parse(result.content[0].text); }
async function invoke(name: string, input: Record<string, unknown>, ctx: ToolContext, opts: ToolRegistrationOptions) {
  const tool = builtinTools.find((candidate) => candidate.name === name);
  assert.ok(tool, `missing ${name}`);
  return tool.handler(input as any, {} as any, ctx, opts);
}
function mockFetch(responder: (url: string, index: number) => Response) {
  const original = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input); urls.push(url); return responder(url, urls.length - 1);
  }) as any;
  return { urls, restore: () => { globalThis.fetch = original; } };
}

test("new capability reads carry accurate annotations and specialized domains remain opt-in", () => {
  const names = [
    "discourse_read_topic_posts", "discourse_get_post_replies", "discourse_list_latest_posts", "discourse_get_topic_view_stats", "discourse_search_posts",
    "discourse_get_user_summary", "discourse_list_user_actions", "discourse_list_directory_items", "discourse_list_categories", "discourse_list_site_settings", "discourse_list_group_posts",
    "discourse_get_user_moderation_summary", "discourse_get_post_revision", "discourse_list_reports", "discourse_get_report", "discourse_get_support_dashboard",
    "discourse_ai_get_topic_summary", "discourse_ai_semantic_search", "discourse_ai_list_sentiment_posts", "discourse_list_themes", "discourse_get_theme",
    "discourse_list_webhooks", "discourse_get_webhook", "discourse_list_webhook_events",
  ];
  for (const name of names) {
    const tool = builtinTools.find((candidate) => candidate.name === name);
    assert.ok(tool, `missing ${name}`);
    assert.equal(tool.annotations?.readOnlyHint, true);
    assert.equal(tool.annotations?.idempotentHint, true);
    assert.equal(tool.annotations?.openWorldHint, true);
  }
  assert.deepEqual(builtinTools.filter((tool) => tool.toolsets.includes("activity")).map((tool) => tool.name), ["discourse_get_post_replies", "discourse_list_latest_posts", "discourse_get_topic_view_stats", "discourse_get_user_summary", "discourse_list_user_actions", "discourse_list_directory_items"]);
  assert.deepEqual(builtinTools.filter((tool) => tool.toolsets.includes("administration")).map((tool) => tool.name), ["discourse_list_categories", "discourse_list_site_settings", "discourse_manage_user_activation"]);
  assert.deepEqual(builtinTools.filter((tool) => tool.toolsets.includes("site_settings")).map((tool) => tool.name), ["discourse_list_site_settings", "discourse_update_site_setting"]);
  assert.deepEqual(builtinTools.filter((tool) => tool.toolsets.includes("webhooks")).map((tool) => tool.name), ["discourse_list_webhooks", "discourse_get_webhook", "discourse_create_webhook", "discourse_update_webhook", "discourse_delete_webhook", "discourse_list_webhook_events", "discourse_ping_webhook", "discourse_redeliver_webhook_event"]);
  for (const name of ["discourse_update_site_setting", "discourse_update_webhook", "discourse_delete_webhook", "discourse_redeliver_webhook_event"]) {
    const tool = builtinTools.find((candidate) => candidate.name === name)!; assert.equal(tool.annotations?.readOnlyHint, false); assert.equal(tool.annotations?.destructiveHint, true); assert.equal(tool.annotations?.openWorldHint, true);
  }
  assert.deepEqual(builtinTools.filter((tool) => tool.toolsets.includes("themes")).map((tool) => tool.name), ["discourse_list_themes", "discourse_get_theme", "discourse_create_theme", "discourse_install_theme", "discourse_update_theme", "discourse_update_theme_fields", "discourse_update_theme_setting", "discourse_update_theme_translations", "discourse_sync_remote_theme", "discourse_upload_theme_asset", "discourse_delete_theme"]);
  assert.deepEqual(builtinTools.filter((tool) => tool.toolsets.includes("analytics")).map((tool) => tool.name), ["discourse_list_reports", "discourse_get_report", "discourse_get_support_dashboard"]);
  assert.deepEqual(builtinTools.filter((tool) => tool.toolsets.includes("ai_insights")).map((tool) => tool.name), ["discourse_ai_get_topic_summary", "discourse_ai_semantic_search", "discourse_ai_list_sentiment_posts"]);
});

test("topic post selection performs bounded IDs-then-posts reads and preserves order", async () => {
  const { ctx, opts } = setup();
  const mock = mockFetch((_url, index) => Response.json(index === 0 ? { post_ids: [1, 2, 3] } : { post_stream: { posts: [
    { id: 3, topic_id: 9, post_number: 3, username: "c", raw: "third body" },
    { id: 2, topic_id: 9, post_number: 2, username: "b", raw: "second body", accepted_answer: true },
  ] } }));
  try {
    const result = body(await invoke("discourse_read_topic_posts", { topic_id: 9, selection_mode: "latest", limit: 2, replies_only: true }, ctx, opts));
    assert.deepEqual(result.posts.map((post: any) => post.id), [2, 3]);
    assert.equal(result.posts[0].raw, "second b");
    assert.equal(result.posts[0].accepted_answer, true);
    assert.equal(result.meta.visible_stream_size, 3);
    assert.equal(mock.urls.length, 2);
    assert.equal(mock.urls[0], "https://example.com/t/9/post_ids.json");
    assert.match(mock.urls[1]!, /post_ids%5B%5D=2&post_ids%5B%5D=3&include_raw=true/);
  } finally { mock.restore(); }
});

test("topic selection rejects mode-specific fields before HTTP", async () => {
  const { ctx, opts } = setup();
  const mock = mockFetch(() => Response.json({}));
  try {
    const result = await invoke("discourse_read_topic_posts", { topic_id: 9, selection_mode: "post_ids", post_ids: [1], limit: 2 }, ctx, opts);
    assert.equal(result.isError, true);
    assert.equal(mock.urls.length, 0);
  } finally { mock.restore(); }
});

test("post search, latest feed, and replies preserve endpoint-specific continuation", async () => {
  const { ctx, opts } = setup();
  const mock = mockFetch((url) => {
    if (url.includes("search.json")) return Response.json({ posts: [{ id: 4, topic_id: 2, post_number: 3, username: "alice", blurb: "matching text", like_count: 2 }], topics: [{ id: 2, title: "T" }], more_full_page_results: true });
    if (url.includes("posts/4/reply-ids")) return Response.json([{ id: 5, level: 1 }]);
    return Response.json({ latest_posts: [{ id: 6, post_number: 1, raw: "starter" }, { id: 5, post_number: 2, raw: "reply" }] });
  });
  try {
    const search = body(await invoke("discourse_search_posts", { query: "matching", page: 2 }, ctx, opts));
    assert.equal(search.posts[0].excerpt, "matching");
    assert.equal(search.meta.has_more, true);
    const replies = body(await invoke("discourse_get_post_replies", { post_id: 4 }, ctx, opts));
    assert.deepEqual(replies.replies, [{ id: 5, level: 1 }]);
    const latest = body(await invoke("discourse_list_latest_posts", { replies_only: true }, ctx, opts));
    assert.deepEqual(latest.posts.map((post: any) => post.id), [5]);
    assert.equal(latest.meta.upstream_returned, 2);
    assert.equal(latest.meta.has_more, null);
  } finally { mock.restore(); }
});

test("user actions and directory expose named events and authoritative totals", async () => {
  const { ctx, opts } = setup();
  const mock = mockFetch((url) => url.includes("user_actions")
    ? Response.json({ user_actions: [{ action_type: 15, post_id: 3, topic_id: 4, excerpt: "accepted answer" }], categories: [{ id: 2 }] })
    : Response.json({ directory_items: [{ id: 1, user: { id: 1, username: "a" }, likes_received: 4 }], meta: { total_rows_directory_items: 11, load_more_directory_items: "/next" } }));
  try {
    const actions = body(await invoke("discourse_list_user_actions", { username: "a", action_types: ["solved"], limit: 10 }, ctx, opts));
    assert.equal(actions.actions[0].action_type, "solved");
    assert.equal(actions.actions[0].action_type_id, 15);
    assert.match(mock.urls[0]!, /filter=15/);
    const directory = body(await invoke("discourse_list_directory_items", { period: "monthly", exclude_groups: ["staff"] }, ctx, opts));
    assert.equal(directory.meta.total, 11);
    assert.equal(directory.meta.has_more, true);
    assert.match(mock.urls[1]!, /exclude_groups=staff/);
  } finally { mock.restore(); }
});

test("opt-in analytics discovers reports before execution and preserves plugin ambiguity", async () => {
  const { ctx, opts } = setup(true);
  const mock = mockFetch((url) => {
    if (url.endsWith("/admin/reports.json")) return Response.json({ reports: [{ type: "topics", title: "Topics" }] });
    if (url.includes("/admin/reports/topics.json")) return Response.json({ report: { type: "topics", data: [{ x: 1 }], higher_is_better: true } });
    return Response.json({ errors: ["not found"] }, { status: 404 });
  });
  try {
    const report = body(await invoke("discourse_get_report", { report_type: "topics", filters: { category_id: 2 }, cache: true }, ctx, opts));
    assert.equal(report.report.type, "topics");
    assert.match(mock.urls[1]!, /filters%5Bcategory_id%5D=2/);
    const missing = await invoke("discourse_get_support_dashboard", {}, ctx, opts);
    assert.equal(missing.isError, true);
    assert.equal(body(missing).code, "capability_or_resource_unavailable");
    assert.equal(body(missing).required_plugin, "discourse-solved");
  } finally { mock.restore(); }
});

test("AI insight reads label cached summaries and upstream sentiment classifications", async () => {
  const { ctx, opts } = setup(true);
  const mock = mockFetch((url) => {
    if (url.includes("summarization")) return Response.json({ ai_topic_summary: { summarized_text: "long summary", outdated: true, new_posts_since_summary: 2 } });
    if (url.includes("semantic-search")) return Response.json({ posts: [{ id: 2, blurb: "semantic hit" }], more_full_page_results: false });
    return Response.json({ posts: [{ post_id: 3, sentiment: "negative", excerpt: "model output" }], has_more: true, next_offset: 1 });
  });
  try {
    const summary = body(await invoke("discourse_ai_get_topic_summary", { topic_id: 4 }, ctx, opts));
    assert.equal(summary.summarized_text, "long sum");
    assert.equal(summary.source, "discourse_ai_cached_summary");
    const semantic = body(await invoke("discourse_ai_semantic_search", { query: "meaning", hyde: false }, ctx, opts));
    assert.equal(semantic.posts[0].excerpt, "semantic");
    assert.equal(semantic.meta.cursor, null);
    const sentiment = body(await invoke("discourse_ai_list_sentiment_posts", { group_by: "category", group_value: "Support", limit: 1 }, ctx, opts));
    assert.equal(sentiment.posts[0].sentiment, "negative");
    assert.equal(sentiment.meta.classification_source, "discourse_ai_active_sentiment_model");
  } finally { mock.restore(); }
});
