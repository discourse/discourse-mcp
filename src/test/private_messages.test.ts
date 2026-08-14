import test from "node:test";
import assert from "node:assert/strict";
import { Logger } from "../util/logger.js";
import { SiteState } from "../site/state.js";
import { privateMessageTools } from "../tools/builtin/private_messages/index.js";
import type { ToolContext, ToolRegistrationOptions } from "../tools/types.js";

interface RequestRecord {
  url: string;
  method: string;
  headers: Headers;
  body?: any;
}

function setup(authenticated = true, allowWrites = true) {
  const logger = new Logger("silent");
  const siteState = new SiteState({
    logger,
    timeoutMs: 5000,
    defaultAuth: authenticated ? { type: "api_key", key: "test-key", username: "system" } : { type: "none" },
  });
  siteState.selectSite("https://example.com");
  const ctx: ToolContext = { server: {} as any, siteState, logger, maxReadLength: 8 };
  const opts: ToolRegistrationOptions = { allowWrites, toolsMode: "discourse_api_only" };
  return { ctx, opts };
}

async function invoke(name: string, input: Record<string, unknown>, authenticated = true, allowWrites = true) {
  const tool = privateMessageTools.find((candidate) => candidate.name === name);
  assert.ok(tool, `missing ${name}`);
  const { ctx, opts } = setup(authenticated, allowWrites);
  return tool.handler(input as any, {} as any, ctx, opts);
}

function body(result: Awaited<ReturnType<typeof invoke>>): any {
  return JSON.parse(String(result.content[0]?.text ?? "{}"));
}

function recordFetch(responder: (request: RequestRecord, index: number) => Response) {
  const original = globalThis.fetch;
  const requests: RequestRecord[] = [];
  globalThis.fetch = async (input, init) => {
    const request: RequestRecord = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    requests.push(request);
    return responder(request, requests.length - 1);
  };
  return { requests, restore: () => { globalThis.fetch = original; } };
}

test("private-message reads require authentication before HTTP", async () => {
  const mock = recordFetch(() => Response.json({}));
  try {
    const result = await invoke("discourse_list_private_messages", {}, false, false);
    assert.equal(result.isError, true);
    assert.match(body(result).error, /No auth configured/);
    assert.equal(mock.requests.length, 0);
  } finally {
    mock.restore();
  }
});

test("list resolves current user uncached and normalizes personal PMs", async () => {
  const mock = recordFetch((_request, index) => index === 0
    ? Response.json({ current_user: { username: "alice" } })
    : Response.json({ topic_list: { more_topics_url: "/next", topics: [{
      id: 42, slug: "secret", title: "Secret", posts_count: 3, reply_count: 2,
      archived: true, message_archived: false, unread_posts: 1, unseen: true,
      participants: [{ user: { id: 2, username: "bob", name: "Bob" } }],
      participant_groups: [{ id: 9, name: "staff" }],
    }] } }));
  try {
    const result = await invoke("discourse_list_private_messages", { page: 0, per_page: 25 }, true, false);
    assert.equal(result.isError, undefined);
    assert.equal(mock.requests[0]?.url, "https://example.com/session/current.json");
    assert.equal(mock.requests[1]?.url, "https://example.com/topics/private-messages/alice.json?page=0&per_page=25");
    assert.deepEqual(body(result), {
      mailbox: "inbox", username: "alice", group_name: null,
      messages: [{
        topic_id: 42, slug: "secret", title: "Secret", posts_count: 3, reply_count: 2,
        created_at: null, last_posted_at: null, bumped_at: null, last_read_post_number: null,
        unread_posts: 1, unseen: true, topic_archived: true, message_archived: false,
        notification_level: null, recent_participants: [{ id: 2, username: "bob", name: "Bob" }],
      }],
      meta: { page: 0, per_page: 25, has_more: true },
    });
  } finally {
    mock.restore();
  }
});

test("list constructs every personal and group mailbox route", async () => {
  const mock = recordFetch(() => Response.json({ topic_list: { topics: [] } }));
  try {
    for (const mailbox of ["inbox", "sent", "archive", "unread", "new"] as const) {
      await invoke("discourse_list_private_messages", { username: "a/b", mailbox }, true, false);
    }
    for (const mailbox of ["inbox", "archive", "unread", "new"] as const) {
      await invoke("discourse_list_private_messages", { username: "a/b", group_name: "review team", mailbox }, true, false);
    }
    assert.deepEqual(mock.requests.map((request) => request.url), [
      "https://example.com/topics/private-messages/a%2Fb.json?page=0&per_page=30",
      "https://example.com/topics/private-messages-sent/a%2Fb.json?page=0&per_page=30",
      "https://example.com/topics/private-messages-archive/a%2Fb.json?page=0&per_page=30",
      "https://example.com/topics/private-messages-unread/a%2Fb.json?page=0&per_page=30",
      "https://example.com/topics/private-messages-new/a%2Fb.json?page=0&per_page=30",
      "https://example.com/topics/private-messages-group/a%2Fb/review%20team.json?page=0&per_page=30",
      "https://example.com/topics/private-messages-group/a%2Fb/review%20team/archive.json?page=0&per_page=30",
      "https://example.com/topics/private-messages-group/a%2Fb/review%20team/unread.json?page=0&per_page=30",
      "https://example.com/topics/private-messages-group/a%2Fb/review%20team/new.json?page=0&per_page=30",
    ]);
    const invalid = await invoke("discourse_list_private_messages", { username: "alice", group_name: "staff", mailbox: "sent" }, true, false);
    assert.equal(invalid.isError, true);
    assert.equal(mock.requests.length, 9);
  } finally {
    mock.restore();
  }
});

test("read returns PM metadata, truncates posts, and rejects public topics", async () => {
  const mock = recordFetch((_request, index) => Response.json(index === 0 ? {
    id: 42, archetype: "private_message", slug: "secret", title: "Secret", posts_count: 2,
    archived: true, message_archived: false, last_read_post_number: 1,
    details: { allowed_users: [{ id: 1, username: "alice" }], allowed_groups: [{ id: 4, name: "staff" }] },
    post_stream: { posts: [{ id: 10, post_number: 1, user_id: 1, username: "alice", created_at: "now", raw: "0123456789" }] },
  } : { archetype: "regular", post_stream: { posts: [] } }));
  try {
    const result = await invoke("discourse_read_private_message", { topic_id: 42, post_limit: 1 }, true, false);
    assert.equal(mock.requests[0]?.url, "https://example.com/t/42.json?include_raw=true");
    assert.deepEqual(body(result).allowed_groups, [{ id: 4, name: "staff" }]);
    assert.equal(body(result).posts[0].raw, "01234567");
    assert.equal(body(result).posts[0].reply_to_post_number, null);
    assert.equal(body(result).meta.has_more, true);

    const publicResult = await invoke("discourse_read_private_message", { topic_id: 9 }, true, false);
    assert.equal(publicResult.isError, true);
    assert.match(body(publicResult).error, /not a private message/);
  } finally {
    mock.restore();
  }
});

test("create sends typed deduplicated recipients and acting-user header", async () => {
  const mock = recordFetch(() => Response.json({ id: 5, topic_id: 42, post_number: 1, topic_slug: "claim-review", topic_title: "Claim review" }));
  try {
    const result = await invoke("discourse_create_private_message", {
      title: "Claim review", raw: "Please review", usernames: [" Alice "],
      group_names: ["reviewers", "alice"], email_addresses: ["EXTERNAL@example.com", "external@example.com"],
      author_username: " admin ",
    });
    assert.equal(mock.requests[0]?.method, "POST");
    assert.equal(mock.requests[0]?.headers.get("Api-Username"), "admin");
    assert.deepEqual(mock.requests[0]?.body, {
      title: "Claim review", raw: "Please review", archetype: "private_message",
      target_recipients: "Alice,reviewers,EXTERNAL@example.com",
    });
    assert.deepEqual(body(result), { id: 5, topic_id: 42, post_number: 1, slug: "claim-review", title: "Claim review" });
  } finally {
    mock.restore();
  }
});

test("create validates typed recipients and write access before HTTP", async () => {
  const mock = recordFetch(() => Response.json({}));
  try {
    assert.equal((await invoke("discourse_create_private_message", { title: "x", raw: "x" })).isError, true);
    assert.equal((await invoke("discourse_create_private_message", { title: "x", raw: "x", usernames: ["a@b"] })).isError, true);
    assert.equal((await invoke("discourse_create_private_message", { title: "x", raw: "x", usernames: ["alice"] }, true, false)).isError, true);
    assert.equal(mock.requests.length, 0);
  } finally {
    mock.restore();
  }
});

test("reply preflights with the acting user and never posts to a public topic", async () => {
  const mock = recordFetch((_request, index) => Response.json(index === 0
    ? { archetype: "private_message" }
    : { id: 8, topic_id: 42, post_number: 3, reply_to_post_number: 2, topic_slug: "secret" }));
  try {
    const result = await invoke("discourse_reply_private_message", { topic_id: 42, raw: "reply", reply_to_post_number: 2, author_username: "alice" });
    assert.equal(mock.requests[0]?.url, "https://example.com/t/42.json?track_visit=false");
    assert.equal(mock.requests[0]?.headers.get("Api-Username"), "alice");
    assert.deepEqual(mock.requests[1]?.body, { topic_id: 42, raw: "reply", reply_to_post_number: 2 });
    assert.equal("archetype" in mock.requests[1]!.body, false);
    assert.deepEqual(body(result), { id: 8, topic_id: 42, post_number: 3, slug: "secret", reply_to_post_number: 2 });
  } finally {
    mock.restore();
  }

  const publicMock = recordFetch(() => Response.json({ archetype: "regular" }));
  try {
    const result = await invoke("discourse_reply_private_message", { topic_id: 7, raw: "unsafe" });
    assert.equal(result.isError, true);
    assert.equal(publicMock.requests.length, 1);
  } finally {
    publicMock.restore();
  }
});

test("invite dispatches user, group notification strings, and opaque email outcomes", async () => {
  const responses = [
    { user: { id: 2, username: "bob", name: "Bob" } },
    { group: { id: 3, name: "Reviewers" } },
    { success: "OK" },
  ];
  const mock = recordFetch((_request, index) => Response.json(responses[index]));
  try {
    const user = await invoke("discourse_invite_to_private_message", { topic_id: 42, username: "bob" });
    const group = await invoke("discourse_invite_to_private_message", { topic_id: 42, group_name: "Reviewers", notify_group_members: false });
    const email = await invoke("discourse_invite_to_private_message", { topic_id: 42, email_address: "new@example.com", custom_message: "Join us" });
    assert.deepEqual(body(user), { topic_id: 42, recipient_type: "user", status: "added", user: { id: 2, username: "bob", name: "Bob" } });
    assert.deepEqual(mock.requests[1]?.body, { group: "Reviewers", should_notify: "false" });
    assert.deepEqual(body(group), { topic_id: 42, recipient_type: "group", status: "added", group: { id: 3, name: "Reviewers" }, notifications_requested: false });
    assert.deepEqual(mock.requests[2]?.body, { email: "new@example.com", custom_message: "Join us" });
    assert.deepEqual(body(email), { topic_id: 42, recipient_type: "email", status: "submitted", participant_added: false, outcome_confirmed: false });
  } finally {
    mock.restore();
  }
});
