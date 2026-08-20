import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { Logger } from "../util/logger.js";
import { SiteState } from "../site/state.js";
import { builtinTools } from "../tools/builtin/catalog.js";
import { groupTools } from "../tools/builtin/groups/index.js";
import { themeTools } from "../tools/builtin/themes/index.js";
import { moderationTools } from "../tools/builtin/moderation/index.js";
import { registerToolDefinitions } from "../tools/definition.js";
import { BUILTIN_TOOLSETS, OPT_IN_TOOLSETS, type BuiltinToolset } from "../tools/toolsets.js";
import type {
  ToolContext,
  ToolRegistrar,
  ToolRegistrationOptions,
} from "../tools/types.js";

const EXPECTED_METADATA = [
  {
    "name": "discourse_select_site",
    "title": "Select Site",
    "description": "Validate and select a Discourse site. Returns JSON with site URL and title.",
    "inputKeys": [
      "site"
    ]
  },
  {
    "name": "discourse_search",
    "title": "Discourse Search",
    "description": "Search site content. Returns JSON object with results array of matching topics (id, slug, title) and meta (total, has_more).",
    "inputKeys": [
      "query",
      "max_results"
    ]
  },
  {
    "name": "discourse_filter_topics",
    "title": "Filter Topics",
    "description": "Discover topics through a filtered, top, or hot view. Filtered uses Discourse TopicsFilter syntax; top uses Discourse's authoritative top score and defaults to weekly; hot is defined exactly as daily top (not sentiment, controversy, or real-time velocity). Returns a uniform rich topic projection and truthful pagination metadata.",
    "inputKeys": [
      "filter",
      "view",
      "top_period",
      "page",
      "per_page"
    ]
  },
  {
    "name": "discourse_read_topic",
    "title": "Read Topic",
    "description": "Read topic metadata and posts. Large post limits can require multiple upstream requests. For moderation queues, prefer reviewable list/detail evidence instead of fanning this tool out across flagged topics.",
    "inputKeys": [
      "topic_id",
      "post_limit",
      "start_post_number"
    ]
  },
  {
    "name": "discourse_read_post",
    "title": "Read Post",
    "description": "Read a specific post. Returns JSON with id, topic_id, post_number, username, created_at, and raw content.",
    "inputKeys": [
      "post_id"
    ]
  },
  {
    "name": "discourse_read_topic_posts",
    "title": "Read Selected Topic Posts",
    "description": "Read exact, earliest, latest, around-post, or username-filtered topic evidence. Selection is bounded to 50 posts and reports the visible stream size without claiming the entire topic was loaded.",
    "inputKeys": [
      "topic_id",
      "selection_mode",
      "limit",
      "post_ids",
      "post_number",
      "usernames",
      "replies_only"
    ]
  },
  {
    "name": "discourse_search_posts",
    "title": "Search Posts",
    "description": "Search post-level evidence with Discourse query syntax. Unlike discourse_search, this preserves matched posts, highlighted blurbs, authors, topics, categories, and truthful bounded continuation. This is keyword search, not Discourse AI semantic search.",
    "inputKeys": [
      "query",
      "page"
    ]
  },
  {
    "name": "discourse_get_user",
    "title": "Get User",
    "description": "Get user info. Returns JSON with id, username, name, trust_level, created_at, bio, admin, and moderator.",
    "inputKeys": [
      "username"
    ]
  },
  {
    "name": "discourse_list_user_posts",
    "title": "List User Posts",
    "description": "Get paginated list of user posts/replies. Returns JSON object with posts array (id, topic_id, post_number, slug, title, created_at, excerpt, category_id) and meta (page, limit, has_more).",
    "inputKeys": [
      "username",
      "page",
      "limit"
    ]
  },
  {
    "name": "discourse_list_users",
    "title": "List Users",
    "description": "List users via admin API. Requires admin API key. Returns ~100 users per page (Discourse's fixed page size). Returns JSON with users array and pagination meta.",
    "inputKeys": [
      "query",
      "filter",
      "order",
      "asc",
      "page"
    ]
  },
  {
    "name": "discourse_get_chat_messages",
    "title": "Get Chat Messages",
    "description": "Get messages from a chat channel. Returns JSON object with channel_id, messages array (id, username, created_at, message, edited, thread_id, in_reply_to_id), and meta.",
    "inputKeys": [
      "channel_id",
      "page_size",
      "target_message_id",
      "direction",
      "target_date"
    ]
  },
  {
    "name": "discourse_get_draft",
    "title": "Get Draft",
    "description": "Retrieve a specific draft by key. Returns JSON with draft_key, sequence, and parsed data (title, reply, categoryId, tags, action).",
    "inputKeys": [
      "draft_key",
      "sequence"
    ]
  },
  {
    "name": "discourse_create_post",
    "title": "Create Post",
    "description": "Create a post in a topic. author_username requires a global API key. Returns the actual upstream author so callers can verify attribution.",
    "inputKeys": [
      "topic_id",
      "raw",
      "author_username"
    ]
  },
  {
    "name": "discourse_create_user",
    "title": "Create User",
    "description": "Create a user through Discourse's signup API using a global admin API key. Reports whether upstream confirmed creation; anti-enumeration responses without user_id remain indeterminate. Optional avatar assignment runs only after confirmed creation.",
    "inputKeys": [
      "username",
      "email",
      "name",
      "password",
      "active",
      "approved",
      "upload_id"
    ]
  },
  {
    "name": "discourse_create_category",
    "title": "Create Category",
    "description": "Create a new category. Returns JSON with id, slug, and name.",
    "inputKeys": [
      "name",
      "color",
      "text_color",
      "emoji",
      "icon",
      "parent_category_id",
      "description"
    ]
  },
  {
    "name": "discourse_create_topic",
    "title": "Create Topic",
    "description": "Create a new topic. author_username requires a global API key. Returns the actual upstream author so callers can verify attribution.",
    "inputKeys": [
      "title",
      "raw",
      "category_id",
      "tags",
      "author_username"
    ]
  },
  {
    "name": "discourse_update_topic",
    "title": "Update Topic",
    "description": "Update an existing topic (title, category, tags, featured_link). Returns JSON with updated topic details.",
    "inputKeys": [
      "topic_id",
      "title",
      "category_id",
      "tags",
      "featured_link",
      "original_title",
      "original_tags"
    ]
  },
  {
    "name": "discourse_update_post",
    "title": "Update Post",
    "description": "Update the content of an existing post. Returns JSON with updated post details.",
    "inputKeys": [
      "post_id",
      "raw",
      "edit_reason"
    ]
  },
  {
    "name": "discourse_update_user",
    "title": "Update User",
    "description": "Update user profile fields. If upload_id is provided, also sets the user's avatar. Returns JSON with success status and updated user details.",
    "inputKeys": [
      "username",
      "name",
      "bio_raw",
      "location",
      "website",
      "title",
      "date_of_birth",
      "locale",
      "profile_background_upload_url",
      "card_background_upload_url",
      "upload_id"
    ]
  },
  {
    "name": "discourse_upload_file",
    "title": "Upload File",
    "description": "Upload an image or file to Discourse. Provide either: image_data (base64 with filename), a remote HTTP(S) URL, or an absolute local file path. user_id is required for avatar/background uploads. Returns upload_id for use in avatar/profile updates. Use short_url to embed images in posts.",
    "inputKeys": [
      "upload_type",
      "image_data",
      "url",
      "filename",
      "user_id"
    ]
  },
  {
    "name": "discourse_save_draft",
    "title": "Create/Save Draft",
    "description": "Create or update a draft. Returns JSON with draft_key and new sequence number.",
    "inputKeys": [
      "draft_key",
      "reply",
      "title",
      "category_id",
      "tags",
      "sequence",
      "action"
    ]
  },
  {
    "name": "discourse_delete_draft",
    "title": "Delete Draft",
    "description": "Delete a draft by key. Requires current sequence number to prevent conflicts.",
    "inputKeys": [
      "draft_key",
      "sequence"
    ]
  },
  {
    "name": "discourse_get_query",
    "title": "Get Data Explorer Query",
    "description": "Get full details of a Data Explorer query including SQL and parameters. Requires admin API key.",
    "inputKeys": [
      "id"
    ]
  },
  {
    "name": "discourse_run_query",
    "title": "Run Data Explorer Query",
    "description": "Execute a Data Explorer query with parameters. Returns columns, rows, result_count, duration_ms. Queries run in read-only transactions with 10-second timeout. Requires admin API key.",
    "inputKeys": [
      "id",
      "params",
      "limit",
      "explain"
    ]
  },
  {
    "name": "discourse_create_query",
    "title": "Create Data Explorer Query",
    "description": "Create a new saved Data Explorer query. Requires admin API key and write access.",
    "inputKeys": [
      "name",
      "sql",
      "description",
      "group_ids"
    ]
  },
  {
    "name": "discourse_update_query",
    "title": "Update Data Explorer Query",
    "description": "Update an existing Data Explorer query. Only provided fields are updated. Requires admin API key and write access.",
    "inputKeys": [
      "id",
      "name",
      "sql",
      "description",
      "group_ids"
    ]
  },
  {
    "name": "discourse_delete_query",
    "title": "Delete Data Explorer Query",
    "description": "Soft-delete a Data Explorer query. The query can be restored by an admin. Requires admin API key and write access.",
    "inputKeys": [
      "id"
    ]
  },
  {
    "name": "discourse_list_private_messages",
    "title": "List Private Messages",
    "description": "List authenticated personal or group private-message mailboxes. Returns normalized JSON messages and pagination metadata.",
    "inputKeys": [
      "username",
      "mailbox",
      "group_name",
      "page",
      "per_page"
    ]
  },
  {
    "name": "discourse_read_private_message",
    "title": "Read Private Message",
    "description": "Read an authenticated private message, its posts, and direct allowed-user and allowed-group records. Rejects public topics.",
    "inputKeys": [
      "topic_id",
      "post_limit",
      "start_post_number"
    ]
  },
  {
    "name": "discourse_create_private_message",
    "title": "Create Private Message",
    "description": "Create a private message for typed user, group, or email recipients. Unknown emails may create staged users. author_username requires a global API key; the response reports actual attribution.",
    "inputKeys": [
      "title",
      "raw",
      "usernames",
      "group_names",
      "email_addresses",
      "author_username"
    ]
  },
  {
    "name": "discourse_reply_private_message",
    "title": "Reply to Private Message",
    "description": "Safely reply to an existing private message after verifying its archetype. author_username requires a global API key; the response reports actual attribution.",
    "inputKeys": [
      "topic_id",
      "raw",
      "reply_to_post_number",
      "author_username"
    ]
  },
  {
    "name": "discourse_invite_to_private_message",
    "title": "Invite to Private Message",
    "description": "Add a user or group to a private message, or submit an opaque email invitation. Email success does not confirm delivery or participant access. author_username requires a global API key.",
    "inputKeys": [
      "topic_id",
      "username",
      "group_name",
      "email_address",
      "notify_group_members",
      "custom_message",
      "author_username"
    ]
  }
] as const;

const EXPECTED_TOOLSETS = {
  discourse_select_site: ["site"],
  discourse_search: ["search","topics"],
  discourse_filter_topics: ["search","topics"],
  discourse_read_topic: ["topics"],
  discourse_read_post: ["topics"],
  discourse_read_topic_posts: ["topics"],
  discourse_get_post_replies: ["activity"],
  discourse_list_latest_posts: ["activity"],
  discourse_get_topic_view_stats: ["activity"],
  discourse_search_posts: ["search","topics"],
  discourse_get_user: ["users"],
  discourse_list_user_posts: ["users","topics"],
  discourse_get_user_summary: ["activity"],
  discourse_list_user_actions: ["activity"],
  discourse_list_directory_items: ["activity"],
  discourse_list_users: ["users"],
  discourse_get_chat_messages: ["chat"],
  discourse_get_draft: ["drafts"],
  discourse_create_post: ["topics"],
  discourse_create_user: ["users"],
  discourse_create_category: ["topics"],
  discourse_create_topic: ["topics"],
  discourse_update_topic: ["topics"],
  discourse_update_post: ["topics"],
  discourse_update_user: ["users"],
  discourse_upload_file: ["uploads"],
  discourse_save_draft: ["drafts"],
  discourse_delete_draft: ["drafts"],
  discourse_get_query: ["data_explorer"],
  discourse_run_query: ["data_explorer"],
  discourse_create_query: ["data_explorer"],
  discourse_update_query: ["data_explorer"],
  discourse_delete_query: ["data_explorer"],
  discourse_list_private_messages: ["private_messages"],
  discourse_read_private_message: ["private_messages"],
  discourse_create_private_message: ["private_messages"],
  discourse_reply_private_message: ["private_messages"],
  discourse_invite_to_private_message: ["private_messages"],
  discourse_list_groups: ["groups"],
  discourse_get_group: ["groups"],
  discourse_list_group_posts: ["groups"],
  discourse_list_group_members: ["groups"],
  discourse_list_group_membership_requests: ["groups"],
  discourse_create_group: ["groups"],
  discourse_update_group: ["groups"],
  discourse_delete_group: ["groups"],
  discourse_add_group_members_by_username: ["groups"],
  discourse_add_group_members_by_user_id: ["groups"],
  discourse_add_group_members_by_email: ["groups"],
  discourse_invite_group_members_by_email: ["groups"],
  discourse_remove_group_members_by_username: ["groups"],
  discourse_remove_group_members_by_user_id: ["groups"],
  discourse_remove_group_members_by_email: ["groups"],
  discourse_add_group_owners_by_username: ["groups"],
  discourse_add_group_owners_by_user_id: ["groups"],
  discourse_add_group_owners_by_email: ["groups"],
  discourse_remove_group_owners_by_username: ["groups"],
  discourse_remove_group_owners_by_user_id: ["groups"],
  discourse_remove_group_owners_by_email: ["groups"],
  discourse_handle_group_membership_request: ["groups"],
  discourse_request_group_membership: ["groups"],
  discourse_join_group: ["groups"],
  discourse_leave_group: ["groups"],
  discourse_get_review_queue_count: ["moderation"],
  discourse_list_reviewables: ["moderation"],
  discourse_list_reviewable_topics: ["moderation"],
  discourse_get_reviewable: ["moderation"],
  discourse_get_user_moderation_summary: ["moderation"],
  discourse_get_post_revision: ["moderation"],
  discourse_perform_reviewable_action: ["moderation"],
  discourse_list_workflows: ["workflows"],
  discourse_get_workflow: ["workflows"],
  discourse_list_workflow_node_types: ["workflows"],
  discourse_resolve_workflow_entity: ["workflows"],
  discourse_list_workflow_templates: ["workflows"],
  discourse_list_workflow_executions: ["workflows"],
  discourse_get_workflow_execution: ["workflows"],
  discourse_list_workflow_versions: ["workflows"],
  discourse_list_workflow_credentials: ["workflows"],
  discourse_evaluate_workflow_expression: ["workflows"],
  discourse_create_workflow: ["workflows"],
  discourse_update_workflow: ["workflows"],
  discourse_delete_workflow: ["workflows"],
  discourse_discard_workflow_draft: ["workflows"],
  discourse_restore_workflow_version: ["workflows"],
  discourse_run_workflow: ["workflows"],
  discourse_run_workflow_step: ["workflows"],
  discourse_update_workflow_pin_data: ["workflows"],
  discourse_ai_list_agents: ["ai_agents","ai_features"],
  discourse_ai_get_agent: ["ai_agents"],
  discourse_ai_create_agent: ["ai_agents"],
  discourse_ai_update_agent: ["ai_agents"],
  discourse_ai_delete_agent: ["ai_agents"],
  discourse_ai_create_agent_user: ["ai_agents"],
  discourse_ai_export_agent: ["ai_agents"],
  discourse_ai_import_agent: ["ai_agents"],
  discourse_ai_get_custom_tool_guide: ["ai_custom_tools"],
  discourse_ai_list_custom_tools: ["ai_custom_tools"],
  discourse_ai_get_custom_tool: ["ai_custom_tools"],
  discourse_ai_create_custom_tool: ["ai_custom_tools"],
  discourse_ai_update_custom_tool: ["ai_custom_tools"],
  discourse_ai_delete_custom_tool: ["ai_custom_tools"],
  discourse_ai_test_custom_tool: ["ai_custom_tools"],
  discourse_ai_export_custom_tool: ["ai_custom_tools"],
  discourse_ai_import_custom_tool: ["ai_custom_tools"],
  discourse_ai_list_features: ["ai_features"],
  discourse_ai_get_feature_config: ["ai_features"],
  discourse_ai_update_feature_config: ["ai_features"],
  discourse_list_categories: ["administration"],
  discourse_list_site_settings: ["administration", "site_settings"],
  discourse_manage_user_activation: ["administration"],
  discourse_update_site_setting: ["site_settings"],
  discourse_list_webhooks: ["webhooks"],
  discourse_get_webhook: ["webhooks"],
  discourse_create_webhook: ["webhooks"],
  discourse_update_webhook: ["webhooks"],
  discourse_delete_webhook: ["webhooks"],
  discourse_list_webhook_events: ["webhooks"],
  discourse_ping_webhook: ["webhooks"],
  discourse_redeliver_webhook_event: ["webhooks"],
  discourse_list_themes: ["themes"],
  discourse_get_theme: ["themes"],
  discourse_create_theme: ["themes"],
  discourse_install_theme: ["themes"],
  discourse_update_theme: ["themes"],
  discourse_update_theme_fields: ["themes"],
  discourse_update_theme_setting: ["themes"],
  discourse_update_theme_translations: ["themes"],
  discourse_sync_remote_theme: ["themes"],
  discourse_upload_theme_asset: ["themes"],
  discourse_delete_theme: ["themes"],
  discourse_list_reports: ["analytics"],
  discourse_get_report: ["analytics"],
  discourse_get_support_dashboard: ["analytics"],
  discourse_ai_get_topic_summary: ["ai_insights"],
  discourse_ai_semantic_search: ["ai_insights"],
  discourse_ai_list_sentiment_posts: ["ai_insights"],
} as const;

function registeredNames(opts: ToolRegistrationOptions): string[] {
  const names: string[] = [];
  const server = {
    registerTool(name: string) {
      names.push(name);
      return {};
    },
  } as unknown as ToolRegistrar;
  const logger = new Logger("silent");
  const ctx: ToolContext = {
    server,
    siteState: new SiteState({
      logger,
      timeoutMs: 5000,
      defaultAuth: { type: "none" },
    }),
    logger,
    maxReadLength: 50000,
  };

  registerToolDefinitions(builtinTools, ctx, opts);
  return names;
}

test("builtinTools definitions satisfy scalable catalog invariants", () => {
  const names = builtinTools.map((tool) => tool.name);
  assert.equal(new Set(names).size, names.length, "built-in names must be unique");

  for (const tool of builtinTools) {
    assert.ok(tool.name.trim().length > 0, "tool name must be non-empty");
    assert.ok(tool.title.trim().length > 0, `${tool.name} title must be non-empty`);
    assert.ok(
      tool.description.trim().length > 0,
      `${tool.name} description must be non-empty`
    );
    assert.ok(
      ["always", "writes_enabled", "site_selection"].includes(tool.availability),
      `${tool.name} must declare a valid availability`
    );
    assert.ok(tool.schema instanceof z.ZodObject, `${tool.name} must use a Zod object schema`);
    assert.ok(tool.toolsets.length > 0, `${tool.name} must belong to a toolset`);
    assert.equal(
      new Set(tool.toolsets).size,
      tool.toolsets.length,
      `${tool.name} toolsets must not contain duplicates`
    );
    for (const toolset of tool.toolsets) {
      assert.ok(
        BUILTIN_TOOLSETS.includes(toolset),
        `${tool.name} has unknown toolset ${toolset}`
      );
    }
    const memberships = tool.toolsets.map((toolset) => (OPT_IN_TOOLSETS as readonly BuiltinToolset[]).includes(toolset));
    assert.ok(memberships.every(Boolean) || memberships.every((value) => !value), `${tool.name} must not mix opt-in and default toolsets`);
  }

  for (const toolset of BUILTIN_TOOLSETS) {
    assert.ok(
      builtinTools.some((tool) => tool.toolsets.includes(toolset)),
      `${toolset} must contain at least one tool`
    );
  }
});

test("builtinTools metadata and deterministic order match the compatibility snapshot", () => {
  const actual = builtinTools.map((tool) => ({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputKeys: Object.keys(tool.schema.shape),
  }));
  const defaultMetadata = actual.filter((_tool, index) =>
    !builtinTools[index]!.toolsets.every((toolset) =>
      (OPT_IN_TOOLSETS as readonly BuiltinToolset[]).includes(toolset)
    )
  );
  assert.deepEqual(defaultMetadata, EXPECTED_METADATA);
  const optInMetadata = actual.filter((_tool, index) =>
    builtinTools[index]!.toolsets.every((toolset) =>
      (OPT_IN_TOOLSETS as readonly BuiltinToolset[]).includes(toolset)
    )
  );
  assert.equal(optInMetadata.length, 105);
  assert.equal(optInMetadata.filter((tool) => tool.name.includes("group")).length, 25);
  assert.equal(optInMetadata.filter((tool) => tool.name.includes("review")).length, 5);
  assert.equal(optInMetadata.filter((tool) => tool.name.includes("workflow")).length, 18);
  assert.equal(optInMetadata.filter((tool) => tool.name.startsWith("discourse_ai_")).length, 23);
  assert.equal(optInMetadata.some((tool) => tool.name.includes("preview")), false);
});

test("builtinTools toolset memberships match the operator-facing contract", () => {
  assert.deepEqual(
    Object.fromEntries(
      builtinTools.map((tool) => [tool.name, [...tool.toolsets]])
    ),
    EXPECTED_TOOLSETS
  );
});

test("builtinTools registration modes equal catalog availability filters", () => {
  const baseOptions: ToolRegistrationOptions = {
    allowWrites: true,
    toolsMode: "discourse_api_only",
  };

  const defaultTools = builtinTools.filter((tool) => !tool.toolsets.every((toolset) => (OPT_IN_TOOLSETS as readonly BuiltinToolset[]).includes(toolset)));
  assert.deepEqual(
    registeredNames(baseOptions),
    defaultTools.map((tool) => tool.name)
  );
  const defaultNames = registeredNames({ ...baseOptions, allowWrites: false });
  assert.ok(defaultNames.includes("discourse_search"));
  assert.ok(defaultNames.includes("discourse_filter_topics"));
  assert.equal(defaultNames.some((name) => name.includes("reviewable") || name === "discourse_get_review_queue_count"), false);
  assert.equal(defaultNames.includes("discourse_get_post_replies"), false);
  assert.equal(defaultNames.includes("discourse_get_user_summary"), false);
  assert.deepEqual(
    defaultNames,
    defaultTools
      .filter((tool) => tool.availability !== "writes_enabled")
      .map((tool) => tool.name)
  );
  assert.deepEqual(
    registeredNames({ ...baseOptions, hideSelectSite: true }),
    defaultTools
      .filter((tool) => tool.availability !== "site_selection")
      .map((tool) => tool.name)
  );
  assert.deepEqual(
    registeredNames({ ...baseOptions, toolsets: [...BUILTIN_TOOLSETS] }),
    builtinTools.map((tool) => tool.name)
  );
});

test("selected built-in toolsets preserve order and compose with availability", () => {
  const baseOptions: ToolRegistrationOptions = {
    allowWrites: true,
    toolsMode: "discourse_api_only",
  };

  assert.deepEqual(
    registeredNames({ ...baseOptions, toolsets: ["data_explorer"] }),
    [
      "discourse_select_site",
      "discourse_get_query",
      "discourse_run_query",
      "discourse_create_query",
      "discourse_update_query",
      "discourse_delete_query",
    ]
  );
  assert.deepEqual(
    registeredNames({
      ...baseOptions,
      allowWrites: false,
      toolsets: ["data_explorer"],
    }),
    [
      "discourse_select_site",
      "discourse_get_query",
      "discourse_run_query",
    ]
  );
  assert.deepEqual(
    registeredNames({
      ...baseOptions,
      toolsets: ["data_explorer"],
      hideSelectSite: true,
    }),
    [
      "discourse_get_query",
      "discourse_run_query",
      "discourse_create_query",
      "discourse_update_query",
      "discourse_delete_query",
    ]
  );

  assert.deepEqual(
    registeredNames({ ...baseOptions, allowWrites: false, toolsets: ["administration"] }),
    ["discourse_select_site", "discourse_list_categories", "discourse_list_site_settings"]
  );
  assert.deepEqual(
    registeredNames({ ...baseOptions, toolsets: ["administration"], hideSelectSite: true }),
    ["discourse_list_categories", "discourse_list_site_settings", "discourse_manage_user_activation"]
  );
  assert.deepEqual(
    registeredNames({ ...baseOptions, allowWrites: false, toolsets: ["site_settings"] }),
    ["discourse_select_site", "discourse_list_site_settings"]
  );
  assert.deepEqual(
    registeredNames({ ...baseOptions, toolsets: ["site_settings"], hideSelectSite: true }),
    ["discourse_list_site_settings", "discourse_update_site_setting"]
  );
  assert.deepEqual(
    registeredNames({ ...baseOptions, allowWrites: false, toolsets: ["webhooks"] }),
    ["discourse_select_site", "discourse_list_webhooks", "discourse_get_webhook", "discourse_list_webhook_events"]
  );
  assert.deepEqual(
    registeredNames({ ...baseOptions, toolsets: ["webhooks"], hideSelectSite: true }),
    ["discourse_list_webhooks", "discourse_get_webhook", "discourse_create_webhook", "discourse_update_webhook", "discourse_delete_webhook", "discourse_list_webhook_events", "discourse_ping_webhook", "discourse_redeliver_webhook_event"]
  );
  assert.deepEqual(
    registeredNames({ ...baseOptions, allowWrites: false, toolsets: ["themes"] }),
    ["discourse_select_site", "discourse_list_themes", "discourse_get_theme"]
  );
  assert.deepEqual(
    registeredNames({ ...baseOptions, toolsets: ["themes"], hideSelectSite: true }),
    themeTools.map((tool) => tool.name)
  );

  assert.deepEqual(
    registeredNames({ ...baseOptions, allowWrites: false, toolsets: ["activity"] }),
    [
      "discourse_select_site",
      "discourse_get_post_replies",
      "discourse_list_latest_posts",
      "discourse_get_topic_view_stats",
      "discourse_get_user_summary",
      "discourse_list_user_actions",
      "discourse_list_directory_items",
    ]
  );

  assert.deepEqual(
    registeredNames({ ...baseOptions, allowWrites: false, toolsets: ["groups"] }),
    [
      "discourse_select_site",
      "discourse_list_groups",
      "discourse_get_group",
      "discourse_list_group_posts",
      "discourse_list_group_members",
      "discourse_list_group_membership_requests",
    ]
  );
  assert.deepEqual(
    registeredNames({ ...baseOptions, toolsets: ["groups"], hideSelectSite: true }),
    groupTools.map((tool) => tool.name)
  );

  assert.deepEqual(
    registeredNames({ ...baseOptions, allowWrites: false, toolsets: ["moderation"] }),
    ["discourse_select_site", ...moderationTools.slice(0, -1).map((tool) => tool.name)]
  );
  assert.deepEqual(
    registeredNames({ ...baseOptions, toolsets: ["moderation"], hideSelectSite: true }),
    moderationTools.map((tool) => tool.name)
  );

  const selectedToolsets = ["users", "topics"] as const;
  const selected = new Set<BuiltinToolset>(selectedToolsets);
  assert.deepEqual(
    registeredNames({ ...baseOptions, toolsets: selectedToolsets }),
    builtinTools
      .filter(
        (tool) =>
          tool.availability === "site_selection" ||
          tool.toolsets.some((toolset) => selected.has(toolset))
      )
      .map((tool) => tool.name)
  );
});
