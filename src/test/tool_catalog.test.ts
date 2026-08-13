import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { Logger } from "../util/logger.js";
import { SiteState } from "../site/state.js";
import { builtinTools } from "../tools/builtin/catalog.js";
import { registerToolDefinitions } from "../tools/definition.js";
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
    "description": "Filter topics with a concise query language. Returns JSON object with results array (id, slug, title) and meta (page, limit, has_more). Query syntax: category/categories (comma=OR, '=category'=without subcats, '-'=exclude), tag/tags (comma=OR, '+'=AND), status:(open|closed|archived|listed|unlisted|public), in:(bookmarked|watching|tracking|muted|pinned), dates: created/activity-(before|after) YYYY-MM-DD or N days, order: activity|created|latest-post|likes|views with optional -asc.",
    "inputKeys": [
      "filter",
      "page",
      "per_page"
    ]
  },
  {
    "name": "discourse_read_topic",
    "title": "Read Topic",
    "description": "Read topic metadata and posts. Returns JSON with id, title, slug, category_id, tags, and posts array.",
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
    "description": "Create a post in a topic. Returns JSON with id, topic_id, and post_number.",
    "inputKeys": [
      "topic_id",
      "raw",
      "author_username"
    ]
  },
  {
    "name": "discourse_create_user",
    "title": "Create User",
    "description": "Create a new user account. If upload_id is provided, sets the user's avatar after creation. Returns JSON with success status and user details.",
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
    "description": "Create a new topic. Returns JSON with id, topic_id, slug, and title.",
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
  }
] as const;

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
  }
});

test("builtinTools metadata and deterministic order match the compatibility snapshot", () => {
  const actual = builtinTools.map((tool) => ({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputKeys: Object.keys(tool.schema.shape),
  }));
  assert.deepEqual(actual, EXPECTED_METADATA);
});

test("builtinTools registration modes equal catalog availability filters", () => {
  const baseOptions: ToolRegistrationOptions = {
    allowWrites: true,
    toolsMode: "discourse_api_only",
  };

  assert.deepEqual(
    registeredNames(baseOptions),
    builtinTools.map((tool) => tool.name)
  );
  assert.deepEqual(
    registeredNames({ ...baseOptions, allowWrites: false }),
    builtinTools
      .filter((tool) => tool.availability !== "writes_enabled")
      .map((tool) => tool.name)
  );
  assert.deepEqual(
    registeredNames({ ...baseOptions, hideSelectSite: true }),
    builtinTools
      .filter((tool) => tool.availability !== "site_selection")
      .map((tool) => tool.name)
  );
});
