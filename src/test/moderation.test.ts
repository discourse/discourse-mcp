import test from "node:test";
import assert from "node:assert/strict";
import { Logger } from "../util/logger.js";
import { SiteState } from "../site/state.js";
import { HttpError } from "../http/client.js";
import { moderationTools } from "../tools/builtin/moderation/index.js";
import { moderationError } from "../tools/builtin/moderation/common.js";
import type { ToolContext, ToolRegistrationOptions } from "../tools/types.js";

interface RequestRecord { url: string; method: string; body?: any }

function setup(authenticated = true, allowWrites = true) {
  const logger = new Logger("silent");
  const siteState = new SiteState({
    logger,
    timeoutMs: 5000,
    defaultAuth: authenticated ? { type: "api_key", key: "test-key", username: "moderator" } : { type: "none" },
  });
  siteState.selectSite("https://example.com");
  const ctx: ToolContext = { server: {} as any, siteState, logger, maxReadLength: 50000 };
  const opts: ToolRegistrationOptions = { allowWrites, toolsMode: "discourse_api_only" };
  return { ctx, opts };
}

async function invoke(name: string, input: Record<string, unknown>, authenticated = true, allowWrites = true) {
  const tool = moderationTools.find((candidate) => candidate.name === name);
  assert.ok(tool, `missing ${name}`);
  const { ctx, opts } = setup(authenticated, allowWrites);
  return tool.handler(input as any, {} as any, ctx, opts);
}

function body(result: Awaited<ReturnType<typeof invoke>>): any {
  const content = result.content[0];
  return JSON.parse(content?.type === "text" ? content.text : "{}");
}

function recordFetch(responder: (request: RequestRecord, index: number) => Response) {
  const original = globalThis.fetch;
  const requests: RequestRecord[] = [];
  globalThis.fetch = async (input, init) => {
    const request = {
      url: String(input), method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    requests.push(request);
    return responder(request, requests.length - 1);
  };
  return { requests, restore: () => { globalThis.fetch = original; } };
}

test("moderation annotations accurately distinguish reads from destructive writes", () => {
  for (const tool of moderationTools.slice(0, -1)) {
    assert.equal(tool.annotations?.readOnlyHint, true, `${tool.name} should be read-only`);
    assert.equal(tool.annotations?.idempotentHint, true, `${tool.name} should be idempotent`);
  }
  const perform = moderationTools.at(-1)!;
  assert.equal(perform.annotations?.readOnlyHint, false);
  assert.equal(perform.annotations?.destructiveHint, true);
  assert.equal(perform.annotations?.idempotentHint, false);
});

test("list treats strict-schema numeric and text placeholders as omitted", async () => {
  const mock = recordFetch(() => Response.json({ reviewables: [], meta: { total_rows_reviewables: 0 } }));
  try {
    const listed = await invoke("discourse_list_reviewables", {
      offset: 0, status: "pending", topic_id: 0, category_id: 0,
      type: "all", priority: "any", reviewed_by: "", claimed_by: "all", flagged_by: "any",
    });
    assert.equal(listed.isError, undefined);
    assert.equal(mock.requests[0]?.url, "https://example.com/review.json?offset=0&status=pending");
    assert.equal(mock.requests.length, 1);
  } finally { mock.restore(); }
});

test("moderation errors identify ambiguous mutations and retry delays", () => {
  const ambiguous = moderationError(
    "perform reviewable action",
    new HttpError(404, "not found"),
    { reviewable_id: 77, action_id: "post-delete_user_block", performed_action: "delete_user_block", mutation_attempted: true },
  );
  assert.deepEqual(body(ambiguous as any), {
    error: "Failed to perform reviewable action: the action request returned not found after preflight; the outcome is unknown and must be verified before retrying",
    status: 404,
    reviewable_id: 77,
    action_id: "post-delete_user_block",
    performed_action: "delete_user_block",
    mutation_attempted: true,
    outcome: "unknown",
    retryable: false,
  });
  const throttled = moderationError("test", new HttpError(429, "rate limited", { errors: ["Please wait 14 seconds before trying again."] }));
  assert.equal(body(throttled as any).retry_after_seconds, 14);
});

test("moderation reads require authentication before HTTP", async () => {
  const mock = recordFetch(() => Response.json({}));
  try {
    for (const [name, input] of [
      ["discourse_get_review_queue_count", {}],
      ["discourse_list_reviewables", {}],
      ["discourse_list_reviewable_topics", {}],
      ["discourse_get_reviewable", { reviewable_id: 1 }],
    ] as const) {
      const result = await invoke(name, input, false, false);
      assert.equal(result.isError, true);
    }
    assert.equal(mock.requests.length, 0);
  } finally { mock.restore(); }
});

test("moderation count, list filters, topic summaries, and detail use authoritative routes", async () => {
  const reviewable = {
    id: 12, type: "ReviewableFlaggedPost", status: 0, topic_id: 7, target_id: 9,
    target_type: "Post", score: 4.5, version: 3, raw: "flagged text",
    bundled_actions: [{ id: "primary", actions: [{ id: "agree_and_keep", label: "Agree and keep" }] }],
  };
  const mock = recordFetch((request) => {
    if (request.url.endsWith("/review/count.json")) return Response.json({ count: 4 });
    if (request.url.includes("/review.json?")) return Response.json({
      reviewables: [reviewable], meta: { total_rows_reviewables: 12, load_more_reviewables: "/review?offset=15" },
    });
    if (request.url.endsWith("/review/topics.json")) return Response.json({ reviewable_topics: [{ id: 7, title: "Flagged", count: 3, unique_users: 2 }] });
    if (request.url.endsWith("/explain.json")) return Response.json({ scores: [{ reason: "spam" }] });
    return Response.json({ reviewable, users: [{ id: 2, username: "alice" }], topics: [{ id: 7, title: "Flagged" }] });
  });
  try {
    assert.deepEqual(body(await invoke("discourse_get_review_queue_count", {})), {
      count: 4,
      unit: "pending_reviewable_queue_items",
      status: "pending",
      scope: "visible_to_authenticated_user",
    });
    const listed = body(await invoke("discourse_list_reviewables", {
      offset: 5, status: "pending", type: "ReviewableFlaggedPost", topic_id: 7, category_id: 3,
      priority: "high", username: "target", reviewed_by: "mod", claimed_by: "alice", flagged_by: "bob",
      from_date: "2026-08-01", to_date: "2026-08-18", sort_order: "score", score_type: "spam",
    }));
    assert.equal(listed.reviewables[0].available_actions[0].id, "agree_and_keep");
    assert.equal(listed.reviewables[0].status, "pending");
    assert.equal(listed.reviewables[0].status_id, 0);
    assert.deepEqual(listed.meta, {
      offset: 5, per_page: 10, total: 12, returned: 1, has_more: true, next_offset: 15,
      scope: "visible_to_authenticated_user", status: "pending",
    });
    const topics = body(await invoke("discourse_list_reviewable_topics", {}));
    assert.equal(topics.topics[0].score_count, 3);
    assert.equal(topics.topics[0].unique_flagger_count, 2);
    assert.equal(topics.meta.exhaustive, false);
    assert.match(topics.meta.count_field, /not reviewable queue items/);
    const detail = body(await invoke("discourse_get_reviewable", { reviewable_id: 12, include_explanation: true }));
    assert.equal(detail.reviewable.version, 3);
    assert.deepEqual(detail.explanation, { scores: [{ reason: "spam" }] });

    assert.equal(mock.requests[1]?.url,
      "https://example.com/review.json?offset=5&status=pending&type=ReviewableFlaggedPost&topic_id=7&category_id=3&priority=high&username=target&reviewed_by=mod&claimed_by=alice&flagged_by=bob&from_date=2026-08-01&to_date=2026-08-18&sort_order=score&score_type=spam");
    assert.deepEqual(mock.requests.slice(2).map((request) => request.url), [
      "https://example.com/review/topics.json",
      "https://example.com/review/12.json",
      "https://example.com/review/12/explain.json",
    ]);
  } finally { mock.restore(); }
});

const freshReviewable = (version = 4) => ({
  reviewable: { id: 12, version, bundled_action_ids: ["primary"] },
  bundled_actions: [{ id: "primary", action_ids: ["approve", "post-reject"] }],
  actions: [
    { id: "approve", label: "Approve", server_action: "approve" },
    { id: "post-reject", label: "Reject", server_action: "reject", require_reject_reason: true },
  ],
});

test("perform reviewable action preflights action and expected version before PUT", async () => {
  const mock = recordFetch(() => Response.json(freshReviewable()));
  try {
    const unavailable = await invoke("discourse_perform_reviewable_action", { reviewable_id: 12, action_id: "delete", confirm: true });
    assert.equal(unavailable.isError, true);
    const conflict = body(await invoke("discourse_perform_reviewable_action", { reviewable_id: 12, action_id: "approve", expected_version: 3, confirm: true }));
    assert.match(conflict.error, /version changed/i);
    const fields = body(await invoke("discourse_perform_reviewable_action", {
      reviewable_id: 12, action_id: "approve", additional_fields: { arbitrary: "secret" }, confirm: true,
    }));
    assert.match(fields.error, /not allowed/i);
    assert.equal(mock.requests.every((request) => request.method === "GET"), true);
  } finally { mock.restore(); }
});

test("perform sends the fresh version and only action-contracted fields", async () => {
  const mock = recordFetch((request) => request.method === "GET"
    ? Response.json(freshReviewable(8))
    : Response.json({ reviewable_perform_result: {
        success: true, remove_reviewable_ids: [12], version: 9, reviewable_count: 41, unseen_reviewable_count: 2,
      } }));
  try {
    const result = await invoke("discourse_perform_reviewable_action", {
      reviewable_id: 12, action_id: "post-reject", expected_version: 8,
      additional_fields: { reject_reason: "duplicate flag" }, confirm: true,
    });
    assert.equal(result.isError, undefined);
    assert.deepEqual(body(result), {
      success: true,
      reviewable_id: 12,
      requested_action_id: "post-reject",
      performed_action: "reject",
      removed_reviewable_ids: [12],
      version: 9,
      remaining_reviewable_count: 41,
      unseen_reviewable_count: 2,
      reviewable: null,
      upstream_result: { success: true, remove_reviewable_ids: [12], version: 9, reviewable_count: 41, unseen_reviewable_count: 2 },
    });
    assert.deepEqual(mock.requests, [
      { url: "https://example.com/review/12.json", method: "GET", body: undefined },
      { url: "https://example.com/review/12/perform/reject.json", method: "PUT", body: { version: 8, reject_reason: "duplicate flag" } },
    ]);
  } finally { mock.restore(); }
});

test("moderation writes remain call-time gated and errors are structured without response bodies", async () => {
  const mock = recordFetch(() => Response.json(freshReviewable()));
  try {
    const disabled = await invoke("discourse_perform_reviewable_action", { reviewable_id: 12, action_id: "approve", confirm: true }, true, false);
    const unauthenticated = await invoke("discourse_perform_reviewable_action", { reviewable_id: 12, action_id: "approve", confirm: true }, false, true);
    assert.equal(disabled.isError, true);
    assert.equal(unauthenticated.isError, true);
    assert.equal(mock.requests.length, 0);

    for (const status of [401, 403, 404, 409, 422, 429]) {
      const response = moderationError("test", new HttpError(status, "HTTP failure", { errors: ["safe upstream detail"], raw: "private review content" }));
      const parsed = body(response as any);
      assert.equal(response.isError, true);
      assert.equal(parsed.status, status);
      assert.match(parsed.error, /safe upstream detail/);
      assert.equal(JSON.stringify(parsed).includes("private review content"), false);
    }
  } finally { mock.restore(); }
});
