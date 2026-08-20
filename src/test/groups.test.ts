import test from "node:test";
import assert from "node:assert/strict";
import { Logger } from "../util/logger.js";
import { SiteState } from "../site/state.js";
import { groupTools } from "../tools/builtin/groups/index.js";
import type { ToolContext, ToolRegistrationOptions } from "../tools/types.js";

interface RequestRecord { url: string; method: string; body?: any }

function setup(authenticated = true, allowWrites = true) {
  const logger = new Logger("silent");
  const siteState = new SiteState({
    logger,
    timeoutMs: 5000,
    defaultAuth: authenticated ? { type: "api_key", key: "test-key", username: "system" } : { type: "none" },
  });
  siteState.selectSite("https://example.com");
  const ctx: ToolContext = { server: {} as any, siteState, logger, maxReadLength: 50000 };
  const opts: ToolRegistrationOptions = { allowWrites, toolsMode: "discourse_api_only" };
  return { ctx, opts };
}

async function invoke(name: string, input: Record<string, unknown>, authenticated = true, allowWrites = true) {
  const tool = groupTools.find((candidate) => candidate.name === name);
  assert.ok(tool, `missing ${name}`);
  const { ctx, opts } = setup(authenticated, allowWrites);
  return tool.handler(input as any, {} as any, ctx, opts);
}

function body(result: Awaited<ReturnType<typeof invoke>>): any {
  const content = result.content[0];
  return JSON.parse(content?.type === "text" ? content.text : "{}");
}

function recordFetch(responder: (request: RequestRecord, index: number) => Response = () => Response.json({ success: "OK" })) {
  const original = globalThis.fetch;
  const requests: RequestRecord[] = [];
  globalThis.fetch = async (input, init) => {
    const request = {
      url: String(input),
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    requests.push(request);
    return responder(request, requests.length - 1);
  };
  return { requests, restore: () => { globalThis.fetch = original; } };
}

test("group reads map directory, detail, member, and requester routes", async () => {
  const mock = recordFetch((request) => Response.json({ route: request.url }));
  try {
    await invoke("discourse_list_groups", { page: 2, order: "user_count", asc: true, type: "public", filter: "dev" }, false, false);
    await invoke("discourse_get_group", { id: 7 }, false, false);
    await invoke("discourse_get_group", { name: "Review Team" }, false, false);
    await invoke("discourse_list_group_members", { name: "Review Team", limit: 25, offset: 10, order: "added_at", asc: true }, false, false);
    await invoke("discourse_list_group_membership_requests", { name: "Review Team", limit: 10, order: "requested_at" });

    assert.deepEqual(mock.requests.map((request) => request.url), [
      "https://example.com/groups.json?page=2&order=user_count&asc=true&filter=dev&type=public",
      "https://example.com/groups/by-id/7.json",
      "https://example.com/groups/Review%20Team.json",
      "https://example.com/groups/Review%20Team/members.json?limit=25&offset=10&order=added_at&asc=true",
      "https://example.com/groups/Review%20Team/members.json?limit=10&order=requested_at&requesters=true",
    ]);
  } finally {
    mock.restore();
  }
});

test("blank optional group query strings are treated as omitted", async () => {
  const mock = recordFetch();
  try {
    const listed = await invoke("discourse_list_groups", {
      page: 0, order: "name", asc: true, type: "public", filter: "", username: "",
    }, false, false);
    assert.equal(listed.isError, undefined);
    const fetched = await invoke("discourse_get_group", { id: 7, name: "   " }, false, false);
    assert.equal(fetched.isError, undefined);
    await invoke("discourse_list_group_members", { name: "staff", filter: "" }, false, false);
    await invoke("discourse_list_group_membership_requests", { name: "staff", filter: "" });

    assert.deepEqual(mock.requests.map((request) => request.url), [
      "https://example.com/groups.json?page=0&order=name&asc=true&type=public",
      "https://example.com/groups/by-id/7.json",
      "https://example.com/groups/staff/members.json",
      "https://example.com/groups/staff/members.json?requesters=true",
    ]);
  } finally {
    mock.restore();
  }
});

test("group create, update, and delete serialize authoritative API contracts", async () => {
  const mock = recordFetch();
  try {
    await invoke("discourse_create_group", {
      name: "reviewers", owner_usernames: ["alice", "bob"], usernames: ["carol"],
      visibility_level: 3, public_admission: true, associated_group_ids: [4],
      custom_fields: { region: "eu" }, plugin_fields: { plugin_flag: true },
    });
    await invoke("discourse_update_group", {
      id: 12, name: "review-team", bio_raw: "Review things", watching_category_ids: [3, 8],
      smtp_enabled: false, update_existing_users: true, plugin_fields: { plugin_mode: "strict" },
    });
    await invoke("discourse_delete_group", { id: 12 });

    assert.deepEqual(mock.requests, [
      {
        url: "https://example.com/admin/groups.json", method: "POST", body: { group: {
          name: "reviewers", visibility_level: 3, public_admission: true, associated_group_ids: [4],
          custom_fields: { region: "eu" }, plugin_flag: true, owner_usernames: "alice,bob", usernames: "carol",
        } },
      },
      {
        url: "https://example.com/groups/12.json", method: "PUT", body: {
          group: { name: "review-team", bio_raw: "Review things", watching_category_ids: [3, 8], smtp_enabled: false, plugin_mode: "strict" },
          update_existing_users: "true",
        },
      },
      { url: "https://example.com/admin/groups/12.json", method: "DELETE", body: undefined },
    ]);
  } finally {
    mock.restore();
  }
});

test("member and owner mutation schemas expose exactly one identifier family", () => {
  const expected: Record<string, string[]> = {
    discourse_add_group_members_by_username: ["id", "usernames", "notify_users"],
    discourse_add_group_members_by_user_id: ["id", "user_ids", "notify_users"],
    discourse_add_group_members_by_email: ["id", "user_emails", "notify_users"],
    discourse_invite_group_members_by_email: ["id", "emails", "skip_email"],
    discourse_remove_group_members_by_username: ["id", "usernames"],
    discourse_remove_group_members_by_user_id: ["id", "user_ids"],
    discourse_remove_group_members_by_email: ["id", "user_emails"],
    discourse_add_group_owners_by_username: ["id", "usernames", "notify_users"],
    discourse_add_group_owners_by_user_id: ["id", "user_ids", "notify_users"],
    discourse_add_group_owners_by_email: ["id", "user_emails", "notify_users"],
    discourse_remove_group_owners_by_username: ["id", "usernames"],
    discourse_remove_group_owners_by_user_id: ["id", "user_ids"],
    discourse_remove_group_owners_by_email: ["id", "user_emails"],
  };
  for (const [name, keys] of Object.entries(expected)) {
    const tool = groupTools.find((candidate) => candidate.name === name);
    assert.ok(tool, `missing ${name}`);
    assert.deepEqual(Object.keys(tool.schema.shape), keys);
  }
});

test("member and owner tools expose one selector each and serialize exact API payloads", async () => {
  const mock = recordFetch();
  try {
    await Promise.all([
      invoke("discourse_add_group_members_by_username", { id: 9, usernames: ["Alice", "bob"], notify_users: false }),
      invoke("discourse_add_group_members_by_user_id", { id: 9, user_ids: [2, 3] }),
      invoke("discourse_add_group_members_by_email", { id: 9, user_emails: ["member@example.com"] }),
      invoke("discourse_invite_group_members_by_email", { id: 9, emails: ["new@example.com"], skip_email: true }),
      invoke("discourse_remove_group_members_by_username", { id: 9, usernames: ["alice"] }),
      invoke("discourse_remove_group_members_by_user_id", { id: 9, user_ids: [4] }),
      invoke("discourse_remove_group_members_by_email", { id: 9, user_emails: ["old@example.com"] }),
      invoke("discourse_add_group_owners_by_username", { id: 9, usernames: ["owner1"], notify_users: true }),
      invoke("discourse_add_group_owners_by_user_id", { id: 9, user_ids: [5] }),
      invoke("discourse_add_group_owners_by_email", { id: 9, user_emails: ["owner@example.com"] }),
      invoke("discourse_remove_group_owners_by_username", { id: 9, usernames: ["owner1"] }),
      invoke("discourse_remove_group_owners_by_user_id", { id: 9, user_ids: [5] }),
      invoke("discourse_remove_group_owners_by_email", { id: 9, user_emails: ["owner@example.com"] }),
    ]);

    assert.deepEqual(mock.requests, [
      { url: "https://example.com/groups/9/members.json", method: "PUT", body: { usernames: "Alice,bob", notify_users: "false" } },
      { url: "https://example.com/groups/9/members.json", method: "PUT", body: { user_ids: "2,3" } },
      { url: "https://example.com/groups/9/members.json", method: "PUT", body: { user_emails: "member@example.com" } },
      { url: "https://example.com/groups/9/members.json", method: "PUT", body: { emails: "new@example.com", skip_email: "true" } },
      { url: "https://example.com/groups/9/members.json", method: "DELETE", body: { usernames: "alice" } },
      { url: "https://example.com/groups/9/members.json", method: "DELETE", body: { user_ids: "4" } },
      { url: "https://example.com/groups/9/members.json", method: "DELETE", body: { user_emails: "old@example.com" } },
      { url: "https://example.com/groups/9/owners.json", method: "PUT", body: { usernames: "owner1", notify_users: "true" } },
      { url: "https://example.com/groups/9/owners.json", method: "PUT", body: { user_ids: "5" } },
      { url: "https://example.com/groups/9/owners.json", method: "PUT", body: { user_emails: "owner@example.com" } },
      { url: "https://example.com/admin/groups/9/owners.json", method: "DELETE", body: { usernames: "owner1" } },
      { url: "https://example.com/admin/groups/9/owners.json", method: "DELETE", body: { user_ids: "5" } },
      { url: "https://example.com/admin/groups/9/owners.json", method: "DELETE", body: { user_emails: "owner@example.com" } },
    ]);
  } finally {
    mock.restore();
  }
});

test("membership request, decision, join, and leave use safe action semantics", async () => {
  const mock = recordFetch((_request, index) => index >= 2 ? new Response(null, { status: 204 }) : Response.json({ success: "OK" }));
  try {
    await invoke("discourse_request_group_membership", { name: "Review Team", reason: "I can help" });
    await invoke("discourse_handle_group_membership_request", { id: 9, user_id: 4, action: "approve" });
    await invoke("discourse_join_group", { id: 9 });
    await invoke("discourse_leave_group", { id: 9 });
    await invoke("discourse_handle_group_membership_request", { id: 9, user_id: 5, action: "deny" });

    assert.deepEqual(mock.requests, [
      { url: "https://example.com/groups/Review%20Team/request_membership.json", method: "POST", body: { reason: "I can help" } },
      { url: "https://example.com/groups/9/handle_membership_request.json", method: "PUT", body: { user_id: 4, accept: true } },
      { url: "https://example.com/groups/9/join.json", method: "PUT", body: {} },
      { url: "https://example.com/groups/9/leave.json", method: "DELETE", body: undefined },
      { url: "https://example.com/groups/9/handle_membership_request.json", method: "PUT", body: { user_id: 5 } },
    ]);
  } finally {
    mock.restore();
  }
});

test("group mutations are write-gated and managed reads require authentication before HTTP", async () => {
  const mock = recordFetch();
  try {
    const writeDenied = await invoke("discourse_update_group", { id: 1, bio_raw: "x" }, true, false);
    assert.equal(writeDenied.isError, true);
    assert.match(body(writeDenied).error, /Writes are disabled/);

    const readDenied = await invoke("discourse_list_group_membership_requests", { name: "staff" }, false, false);
    assert.equal(readDenied.isError, true);
    assert.match(body(readDenied).error, /No auth configured/);

    const wrongSelector = await invoke("discourse_remove_group_members_by_username", { id: 1, user_ids: [2] });
    assert.equal(wrongSelector.isError, true);
    assert.match(body(wrongSelector).error, /Validation failed/);
    assert.equal(mock.requests.length, 0);
  } finally {
    mock.restore();
  }
});
