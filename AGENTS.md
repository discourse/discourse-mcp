## Discourse MCP — Agent Guide

### What this is

- **Purpose**: An MCP (Model Context Protocol) stdio server that exposes Discourse forum capabilities as tools and resources for AI agents.
- **Entry point**: `src/index.ts` → compiled to `dist/index.js` (binary name: `discourse-mcp`).
- **SDK**: `@modelcontextprotocol/sdk`. Node ≥ 18.
- **Version**: 0.2.0 (breaking changes from 0.1.x - JSON-only output, resources replace list tools)

### How it works

- On start, the server validates CLI flags via Zod, constructs a dynamic site state, and registers tools and resources on an MCP server named `@discourse/mcp`.
- Choose a target Discourse site by either:
  - Calling the `discourse_select_site` tool (validates via `/about.json`), or
  - Starting with `--site <url>` to tether to a single site (validates via `/about.json` and hides `discourse_select_site`).
- **All outputs are JSON-only** (no Markdown) for reliable programmatic parsing.

### Authentication & permissions

- Supported auth:
  - **None** (read-only public data)
  - Per-site overrides via `--auth_pairs`, e.g. `[{"site":"https://example.com","api_key":"...","api_username":"system"}]`.
- **Writes are disabled by default**. Write tools are only registered when:
  - `--allow_writes` AND not `--read_only` AND a matching `auth_pairs` entry exists for the selected site.
- Secrets are never logged; config is redacted before logging.

### MCP Resources (URI-addressable read-only data)

Resources provide static/semi-static data via URI addressing. Use these instead of tools for listing operations.

- **discourse://site/categories**

  - **Output**: JSON with `categories` array and `meta.total`
  - **Category fields**: `id`, `name`, `slug`, `pid` (parent_id), `read_restricted`, `topic_count`, `post_count`, `perms` (array of `{gid, perm}`)
  - **Permission types**: 1=full, 2=create_post, 3=readonly
  - **Note**: `perms` is only populated with admin/moderator auth. Without admin auth, only `read_restricted` boolean is available.

- **discourse://site/tags**

  - **Output**: JSON with `tags` array (`id`, `count`) and `meta.total`

- **discourse://site/groups**

  - **Output**: JSON with `groups` array and `meta.total`
  - **Group fields**: `id`, `name`, `automatic`, `user_count`, `vis`, `members_vis`, `mention`, `msg`, `public_admission`, `public_exit`, `allow_membership_requests`
  - **Levels** (0-4): 0=public, 1=logged_on_users, 2=members, 3=staff, 4=owners
  - **Use case**: Resolve `gid` values from category permissions to group names, replicate group settings during migrations

- **discourse://chat/channels**

  - **Output**: JSON with `channels` array and `meta.total`
  - **Channel fields**: `id`, `title`, `slug`, `status`, `members_count`, `description`

- **discourse://user/chat-channels**

  - **Output**: JSON with `public_channels` array, `dm_channels` array, and `meta.total`
  - **Channel fields**: `id`, `title`, `slug`, `status`, `unread_count`, `mention_count`
  - **Note**: Requires authentication

- **discourse://user/drafts**
  - **Output**: JSON with `drafts` array and `meta.total`
  - **Draft fields**: `draft_key`, `sequence`, `title`, `category_id`, `created_at`, `reply_preview`
  - **Note**: Requires authentication

### Tools exposed (built-in)

All tools return **strict JSON** (no Markdown). Every response includes relevant IDs for chaining.

- **discourse_search**

  - **Input**: `{ query: string; max_results?: number (1–50, default 10) }`
  - **Output**: `{ results: [{id, slug, title}], meta: {total, has_more} }`

- **discourse_filter_topics**

  - **Input**: `{ filter: string; page?: number; per_page?: number (1–50, default 20) }`
  - **Output**: `{ results: [{id, slug, title}], meta: {page, limit, has_more} }`
  - Query syntax: `category:support status:open created-after:30 order:activity`

- **discourse_read_topic**

  - **Input**: `{ topic_id: number; post_limit?: number (1–50, default 5); start_post_number?: number }`
  - **Output**: `{ id, title, slug, category_id, tags, posts_count, posts: [{id, post_number, username, created_at, raw}], meta }`

- **discourse_read_post**

  - **Input**: `{ post_id: number }`
  - **Output**: `{ id, topic_id, topic_slug, post_number, username, created_at, raw, truncated }` (`truncated` is boolean)

- **discourse_get_user**

  - **Input**: `{ username: string }`
  - **Output**: `{ id, username, name, trust_level, created_at, bio, admin, moderator }` (all fields included)

- **discourse_list_user_posts**

  - **Input**: `{ username: string; page?: number (0-based); limit?: number (1–50, default 30) }`
  - **Output**: `{ posts: [{id, topic_id, post_number, slug, title, created_at, excerpt, category_id}], meta: {page, limit, has_more} }`

- **discourse_get_chat_messages**

  - **Input**: `{ channel_id: number; page_size?: number (1–50, default 50); target_message_id?: number; direction?: "past"|"future" }`
  - **Output**: `{ channel_id, messages: [{id, username, created_at, message, edited, thread_id, in_reply_to_id}], meta }`

- **discourse_get_draft**

  - **Input**: `{ draft_key: string; sequence?: number }`
  - **Output**: `{ draft_key, sequence, found, data: {title, reply, category_id, tags, action} }`

- **discourse_create_post** (conditionally available)

  - **Input**: `{ topic_id: number; raw: string }`
  - **Output**: `{ id, topic_id, post_number }` (on success)

- **discourse_create_topic** (conditionally available)

  - **Input**: `{ title: string; raw: string; category_id?: number; tags?: string[] }`
  - **Output**: `{ id, topic_id, slug, title }` (on success)

- **discourse_create_category** (conditionally available)

  - **Input**: `{ name: string; color?: hex; parent_category_id?: number; description?: string }`
  - **Output**: `{ id, slug, name }` (on success)

- **discourse_save_draft** (conditionally available)

  - **Input**: `{ draft_key: string; reply: string; title?: string; category_id?: number; tags?: string[]; sequence?: number }`
  - **Output**: `{ draft_key, sequence, saved }`

- **discourse_delete_draft** (conditionally available)

  - **Input**: `{ draft_key: string; sequence: number }`
  - **Output**: `{ draft_key, deleted }`

- **discourse_select_site** (hidden when `--site` is provided)
  - **Input**: `{ site: string }`
  - **Output**: `{ site, title }` (validates via `/about.json`)

### Remote Tool Execution API (optional)

- If the target Discourse site exposes an MCP-compatible Tool Execution API:
  - GET `/ai/tools` is discovered after selecting a site when `tools_mode` is `auto` (default) or `tool_exec_api`.
  - Each remote tool is registered dynamically using its JSON Schema input.
  - Calls POST `/ai/tools/{name}/call` with `{ arguments, context: {} }`.
- Set `--tools_mode=discourse_api_only` to disable remote tool discovery.

### CLI configuration

- **Optional flags**:
  - `--auth_pairs` (JSON)
  - `--read_only` (default true), `--allow_writes` (default false)
  - `--timeout_ms <number>` (default 15000)
  - `--concurrency <number>` (default 4)
  - `--cache_dir <path>` (currently unused; in-memory caching is built-in)
  - `--log_level <silent|error|info|debug>` (default info)
  - `--tools_mode <auto|discourse_api_only|tool_exec_api>` (default auto)
  - `--profile <path.json>`: load partial config from JSON (flags override)
  - `--site <url>`: tether to a single site (hides `discourse_select_site`)
  - `--default-search <prefix>`: unconditionally prefix every search query (e.g., `category:support tag:ai`)
  - `--max-read-length <number>` (default 50000): maximum number of characters returned for post content in `discourse_read_post` and per-post content in `discourse_read_topic`. Tools prefer `raw` content via Discourse API (`include_raw=true`) when available.

### Networking & resilience

- User-Agent: `Discourse-MCP/0.x (+https://github.com/discourse/discourse-mcp)`.
- Retries on 429/5xx with backoff (3 attempts).
- Lightweight in-memory GET cache for selected endpoints (e.g., topics, site metadata).

### Errors & rate limits

- Tool failures return `isError: true` with JSON error object: `{ error: "message" }`.
- Write tools enforce ~1 request/second rate limit.

### Source map

- MCP server and CLI: `src/index.ts`
- HTTP client: `src/http/client.ts`
- Tool registry: `src/tools/registry.ts`
- Resource registry: `src/resources/registry.ts`
- Built-in tools: `src/tools/builtin/*`
- JSON helpers: `src/util/json_response.ts`
- Remote tools: `src/tools/remote/tool_exec_api.ts`
- Logging/redaction: `src/util/logger.ts`, `src/util/redact.ts`

### Quick start (for human operators)

- Build: `pnpm build`
- Run: `node dist/index.js`
- Select site with `discourse_select_site` in your client
