## Discourse MCP

A Model Context Protocol (MCP) stdio server that exposes Discourse forum capabilities as tools and resources for AI agents.

- **Entry point**: `src/index.ts` → compiled to `dist/index.js` (binary name: `discourse-mcp`)
- **SDK**: `@modelcontextprotocol/sdk`
- **Node**: >= 24
- **Version**: 0.2.9 (0.2.x has breaking changes from 0.1.x - JSON-only output, resources replace list tools)

### Quick start (release)

- **Run (read‑only, recommended to start)**

```bash
npx -y @discourse/mcp@latest
```

Then, in your MCP client, either:

- Call the `discourse_select_site` tool with `{ "site": "https://try.discourse.org" }` to choose a site, or
- Start the server tethered to a site using `--site https://try.discourse.org` (in which case `discourse_select_site` is hidden).

- **Enable writes (opt‑in, safe‑guarded)**

```bash
npx -y @discourse/mcp@latest --allow_writes --read_only=false --auth_pairs '[{"site":"https://try.discourse.org","api_key":"'$DISCOURSE_API_KEY'","api_username":"system"}]'
```

- **Run with only Data Explorer built-in tools**

```bash
npx -y @discourse/mcp@latest --toolsets data_explorer --tools_mode discourse_api_only
```

This exposes `discourse_select_site` plus the read-only Data Explorer tools. Add `--site`, authentication, and the write flags as needed; see [Built-in toolsets](#built-in-toolsets).

- **Use in an MCP client (example: Claude Desktop) — via npx**

```json
{
  "mcpServers": {
    "discourse": {
      "command": "npx",
      "args": ["-y", "@discourse/mcp@latest"],
      "env": {}
    }
  }
}
```

> Alternative: if you prefer a global binary after install, the package exposes `discourse-mcp`.
>
> ```json
> {
>   "mcpServers": {
>     "discourse": { "command": "discourse-mcp", "args": [] }
>   }
> }
> ```

## Configuration

The server registers tools under the MCP server name `@discourse/mcp`. Choose a target Discourse site either by:

- Using the `discourse_select_site` tool at runtime (validates via `/about.json`), or
- Supplying `--site <url>` to tether the server to a single site at startup (validates via `/about.json` and hides `discourse_select_site`).

- **Auth**

  - **None** by default.
  - **Admin API Keys** (require admin permissions): **`--auth_pairs '[{"site":"https://example.com","api_key":"...","api_username":"system"}]'`**
  - **User API Keys** (any user can generate): **`--auth_pairs '[{"site":"https://example.com","user_api_key":"...","user_api_client_id":"..."}]'`**
  - **HTTP Basic Auth** (for sites behind a reverse proxy): Add `http_basic_user` and `http_basic_pass` to any `auth_pairs` entry. This is useful for Discourse sites protected by HTTP Basic Authentication at the reverse proxy level.
  - You can include multiple entries in `auth_pairs`; the matching entry is used for the selected site. If both `user_api_key` and `api_key` are provided for the same site, `user_api_key` takes precedence.

- **Write safety**

  - Writes are disabled by default.
  - Built-in write tools are only registered when `--allow_writes` is enabled **and** `--read_only=false`. This includes post, topic, category, user, upload, draft, and saved Data Explorer query mutations.
  - Toolset selection does not bypass write safety. A selected write tool remains absent unless writes are enabled.
  - Write tools require a matching `auth_pairs` entry for the selected site; otherwise they return an error.
  - A ~1 req/sec rate limit is enforced for write actions.

- **Flags & defaults**

  - `--read_only` (default: true)
  - `--allow_writes` (default: false)
  - `--timeout_ms <number>` (default: 15000)
  - `--concurrency <number>` (default: 4)
  - `--log_level <silent|error|info|debug>` (default: info)
    - `debug`: Shows HTTP request URLs, statuses, and detailed network/retry information (response bodies are never logged because admin APIs may echo sensitive content)
    - `info`: Shows retry attempts and general operational messages
    - `error`: Shows only errors
    - `silent`: No logging output
  - `--show_emails` (default: false). includes emails in user tools. Requires admin access
  - `--tools_mode <auto|discourse_api_only|tool_exec_api>` (default: auto)
  - `--toolsets <name[,name...]>`: Expose selected built-in domains. Omit for the default catalog (all non-opt-in domains); use `--toolsets all` to include opt-in workflows and AI administration domains. See [Built-in toolsets](#built-in-toolsets).
  - `--site <url>`: Tether MCP to a single site and hide `discourse_select_site`.
  - `--default-search <prefix>`: Unconditionally prefix every search query (e.g., `tag:ai order:latest`).
  - `--max-read-length <number>`: Maximum characters returned for post content (default 50000). Applies to `discourse_read_post` and per-post content in `discourse_read_topic`. The tools prefer `raw` content by requesting `include_raw=true`.
  - `--allowed_upload_paths <paths>`: Comma-separated list or JSON array of directories allowed for local file uploads. Required to enable local file uploads in `discourse_upload_file`. Example: `--allowed_upload_paths "/home/user/images,/tmp/uploads"` or `--allowed_upload_paths '["/home/user/images"]'`
  - `--transport <stdio|http>` (default: stdio): Transport type. Use `stdio` for standard input/output (default), or `http` for Streamable HTTP transport (stateless mode with JSON responses).
  - `--port <number>` (default: 3000): Port to listen on when using HTTP transport.
  - `--cache_dir <path>` (reserved)
  - `--profile <path.json>` (see below)

- **Profile file** (keep secrets off the command line)

```json
{
  "auth_pairs": [
    {
      "site": "https://try.discourse.org",
      "api_key": "<redacted>",
      "api_username": "system"
    },
    {
      "site": "https://example.com",
      "user_api_key": "<user_api_key>",
      "user_api_client_id": "<client_id>"
    },
    {
      "site": "https://protected.example.com",
      "api_key": "<redacted>",
      "api_username": "system",
      "http_basic_user": "username",
      "http_basic_pass": "password"
    }
  ],
  "read_only": false,
  "allow_writes": true,
  "show_emails": true,
  "log_level": "info",
  "tools_mode": "auto",
  "site": "https://try.discourse.org",
  "default_search": "tag:ai order:latest",
  "max_read_length": 50000,
  "transport": "stdio",
  "port": 3000,
  "allowed_upload_paths": ["/home/user/images", "/tmp/uploads"]
}
```

Run with:

```bash
node dist/index.js --profile /absolute/path/to/profile.json
```

Flags still override values from the profile.

### Built-in toolsets

Toolsets let an operator expose only the built-in domains needed by an MCP client. They are optional: when `--toolsets` and the profile field are both omitted, the server registers the default catalog (all non-opt-in domains). The admin-only `workflows`, `ai_agents`, `ai_custom_tools`, and `ai_features` domains are opt-in. Use `--toolsets all` to explicitly load every domain.

Pass one name or a comma-separated union:

```bash
# Data Explorer reads, plus the site-selection bootstrap tool
npx -y @discourse/mcp@latest \
  --toolsets data_explorer \
  --tools_mode discourse_api_only

# Search and topic tools, retaining canonical registration order
npx -y @discourse/mcp@latest \
  --toolsets search,topics \
  --tools_mode discourse_api_only

# Every built-in domain, including opt-in workflows
npx -y @discourse/mcp@latest \
  --toolsets all \
  --tools_mode discourse_api_only

# Author, test, and run workflows (admin key required)
npx -y @discourse/mcp@latest \
  --toolsets workflows \
  --site https://forum.example.com \
  --auth_pairs '[{"site":"https://forum.example.com","api_key":"...","api_username":"system"}]' \
  --allow_writes --read_only=false \
  --tools_mode discourse_api_only
```

Profiles use an array (a comma-separated string is also accepted):

```json
{
  "toolsets": ["users", "uploads"]
}
```

Available toolsets are:

| Toolset | Built-in tools |
|---|---|
| `site` | `discourse_select_site` (also retained implicitly as bootstrap for any untethered subset) |
| `search` | Search and topic filtering |
| `topics` | Search/filter, topic and post reads, user-post activity, and topic/post/category mutations |
| `users` | User lookup/list/activity and user mutations |
| `chat` | Chat message retrieval |
| `drafts` | Draft retrieval, save, and deletion |
| `uploads` | File upload |
| `data_explorer` | Query retrieval, execution, creation, update, and deletion |
| `workflows` *(opt-in)* | Admin-only workflow discovery, graph authoring, expression evaluation, pin-data, draft runs, step runs, executions, and version management |
| `ai_agents` *(opt-in)* | Admin-only AI agent discovery, typed lifecycle, bot-user creation, and portable import/export |
| `ai_custom_tools` *(opt-in)* | Admin-only database-backed scripted custom-tool guide, lifecycle, actual execution testing, and import/export |
| `ai_features` *(opt-in)* | Admin-only AI feature discovery and exact-area, non-secret feature-setting updates; also includes agent discovery |
| `all` *(sentinel)* | Expands to every built-in toolset, including opt-in domains; absorbs other selections |

Toolset membership is intentionally separate from safety and authorization:

- Selected toolsets form a union. A tool in multiple selected sets is registered once, in the canonical built-in order. `all` expands to every real domain and is never tool metadata.
- Omitted selection excludes opt-in-only tools. Tool definitions may not mix opt-in and default memberships, which prevents accidental default exposure.
- `discourse_select_site` is automatically retained as a bootstrap capability for every untethered subset. With `--site`, it remains hidden as usual.
- Read-only mode still removes tools that require write enablement. For example, `--toolsets data_explorer` exposes query retrieval and execution by default; add both `--allow_writes` and `--read_only=false` to expose saved-query mutations.
- Existing call-time authentication and admin checks are unchanged. All Data Explorer tools still require admin access when called.
- Toolsets filter **built-in tools only; they are not an authorization or complete capability boundary**. MCP resources and prompts remain available, and all existing call-time access checks remain authoritative. Remote Tool Execution API discovery is controlled independently by `--tools_mode`; use `--tools_mode discourse_api_only` when the MCP tool list must contain only the selected built-in domains. The server logs an informational notice when selected toolsets are combined with remote discovery.
- A selected domain can contribute no tools under the current safety configuration—for example, `uploads` in read-only mode. The server logs an informational notice when this occurs.
- Unknown or empty toolset selections are configuration errors. Values are de-duplicated after trimming whitespace.

#### Workflow authoring

The `workflows` toolset targets the experimental `discourse-workflows` plugin (`enable_discourse_workflows`) and requires an admin API key. A typical loop is:

1. List node types, then request a specific `identifier` for its parameter schema, output ports, and `$json` contracts.
2. Resolve category, tag, group, user, badge, chat channel, or data-table ids.
3. Create from a template or submit a complete small graph.
4. GET the workflow immediately before editing. Replace with complete `nodes` **and** `connections`, or use MCP-side `operations[]` for mechanical edits. Omitting a node from a whole-graph update deletes it.
5. Add pin-data and step-run, or manually run the current draft; poll `discourse_get_workflow_execution`.
6. Set `published: true` after testing.

Flat connections such as `[{"from":"Start","to":"Check","type":"main"}]` are accepted and converted to Discourse's nested wire format. Use the source node's catalog output key: condition/filter ports are `true` and `false`, not always `main`. MCP rejects one-sided graph updates before HTTP. Runs are not dry-runs and can create posts, send chat messages, or call external HTTP.

#### Discourse AI administration

The three AI administration domains require a Discourse admin API key (or an admin user API key accepted by the selected endpoint). They are independently opt-in and default-off. Mutations—and custom-tool test execution—also require both `--allow_writes` and `--read_only=false`.

```bash
# Configure agents without exposing scripted source management
npx -y @discourse/mcp@latest --site https://forum.example.com \
  --toolsets ai_agents --tools_mode discourse_api_only \
  --auth_pairs '[{"site":"https://forum.example.com","api_key":"...","api_username":"system"}]' \
  --allow_writes --read_only=false

# Assign agents and update safe feature settings, but do not expose custom-tool code editing
npx -y @discourse/mcp@latest --site https://forum.example.com \
  --toolsets ai_agents,ai_features --tools_mode discourse_api_only \
  --auth_pairs '[{"site":"https://forum.example.com","api_key":"...","api_username":"system"}]' \
  --allow_writes --read_only=false
```

The agent index is intentionally concise by default: `discourse_ai_list_agents` omits system prompts and per-agent configuration, returning summary counts plus slim tool/model catalogs. Use `discourse_ai_get_agent` with an ID to inspect one full configuration. `view: "full"` is available only for clients that explicitly need the complete upstream index.

`discourse_ai_list_custom_tools` follows the same pattern: it returns compact records and preset signatures without scripts, bindings, or verbose parameter documentation. Use `discourse_ai_get_custom_tool` for one stored tool, or call the guide with `topic: "presets"` and a `preset_id` for one complete preset example.

`ai_custom_tools` manages Discourse's database-backed `AiTool` records. It is separate from remote tools dynamically discovered at `/ai/tools`, which remain controlled by `--tools_mode`. Script authoring is synchronous MiniRacer JavaScript: define `invoke(parameters)`; do not use `async`, browser APIs, or Node modules. Call `discourse_ai_get_custom_tool_guide` with only the focused `topic` you need. `preset_id` is optional and meaningful only for `topic: "presets"`; it is ignored for other topics. Use `topic: "preamble"` for the exact selected-server contract before creating or substantially changing a script. The same exact live preamble and minimal template is exposed as the conditional `discourse://ai/custom-tools/authoring-guide` resource when this toolset is selected. Resources are application-driven; the guide tool is model-controlled, so autonomous clients should use the tool rather than assume a host attached the resource. A future optional authoring prompt would be user-controlled and would guide an explicitly initiated workflow rather than replace model-callable discovery.

**Safety:** `discourse_ai_test_custom_tool` actually executes code and can issue external requests or cause site side effects. Feature updates alter production behavior immediately and are limited to non-secret settings returned from one exact `ai-features/<module>` area. Custom-tool source, prompts, bindings, exports, and test parameters should be treated as sensitive. Use the narrowest toolset combination and test on a non-production site first.

- **Remote Tool Execution API (optional)**

  - With `tools_mode=auto` (default) or `tool_exec_api`, the server discovers remote tools via GET `/ai/tools` after you select a site (or immediately at startup if `--site` is provided) and registers them dynamically. Set `--tools_mode=discourse_api_only` to disable remote tool discovery.

- **Networking & resilience**

  - Retries on 429/5xx with backoff (3 attempts).
  - Lightweight in‑memory GET cache for selected endpoints.

- **Privacy**
  - Secrets are redacted in logs. Errors are returned as human‑readable messages to MCP clients.

## MCP Resources

Resources provide static/semi-static read-only data via URI addressing. Use these instead of tools for listing operations.

- **discourse://site/categories**

  - List all categories with hierarchy and permissions
  - Output: `{ categories: [{id, name, slug, pid, read_restricted, topic_count, post_count, perms}], meta: {total} }`
  - `perms` is array of `{gid, perm}` where perm: 1=full, 2=create_post, 3=readonly
  - **Note**: `perms` is only populated with admin/moderator auth. Without admin auth, only `read_restricted` boolean is available.

- **discourse://site/tags**

  - List all tags with usage counts
  - Output: `{ tags: [{id, name, count}], meta: {total} }`

- **discourse://site/groups**

  - List all groups with visibility, interaction levels, and access settings
  - Output: `{ groups: [{id, name, automatic, user_count, vis, members_vis, mention, msg, public_admission, public_exit, allow_membership_requests}], meta: {total} }`
  - **Levels** (0-4): 0=public, 1=logged_on_users, 2=members, 3=staff, 4=owners
  - **Use case**: Resolve `gid` values from category permissions to group names, replicate group settings during migrations

- **discourse://chat/channels**

  - List all public chat channels
  - Output: `{ channels: [{id, title, slug, status, members_count, description}], meta: {total} }`

- **discourse://user/chat-channels**

  - List user's chat channels (public + DMs) with unread/mention counts
  - Output: `{ public_channels: [...], dm_channels: [...], meta: {total} }`
  - Requires authentication

- **discourse://user/drafts**
  - List user's drafts
  - Output: `{ drafts: [{draft_key, sequence, title, category_id, created_at, reply_preview}], meta: {total} }`
  - Requires authentication

- **discourse://ai/custom-tools/authoring-guide** *(conditional)*
  - Registered only when `ai_custom_tools` is selected (including through `all`)
  - Returns the exact selected-site `empty_tool` JavaScript preset: Discourse's current preamble plus minimal `invoke`/`details` template
  - MIME type: `text/javascript`; requires selected-site admin credentials
  - Applications may attach this resource; models can retrieve the same content with `discourse_ai_get_custom_tool_guide` and `topic: "preamble"`

## Tools

Built‑in tools (always present unless noted). All tools return **strict JSON** (no Markdown).

- `discourse_search`
  - Input: `{ query: string; max_results?: number (1–50, default 10) }`
  - Output: `{ results: [{id, slug, title}], meta: {total, has_more} }`
- `discourse_read_topic`
  - Input: `{ topic_id: number; post_limit?: number (1–50, default 5); start_post_number?: number }`
  - Output: `{ id, title, slug, category_id, tags, posts_count, posts: [{id, post_number, username, created_at, raw}], meta }`
- `discourse_read_post`
  - Input: `{ post_id: number }`
  - Output: `{ id, topic_id, topic_slug, post_number, username, created_at, raw, truncated }`
- `discourse_get_user`
  - Input: `{ username: string }`
  - Output: `{ id, username, name, trust_level, created_at, bio, admin, moderator }`
- `discourse_list_user_posts`
  - Input: `{ username: string; page?: number (0-based); limit?: number (1–50, default 30) }`
  - Output: `{ posts: [{id, topic_id, post_number, slug, title, created_at, excerpt, category_id}], meta: {page, limit, has_more} }`
- `discourse_filter_topics`
  - Input: `{ filter: string; page?: number; per_page?: number (1–50) }`
  - Output: `{ results: [{id, slug, title}], meta: {page, limit, has_more} }`
  - Query language (succinct): key:value tokens separated by spaces; category/categories (comma = OR, `=category` = without subcats, `-` prefix = exclude); tag/tags (comma = OR, `+` = AND) and tag_group; status:(open|closed|archived|listed|unlisted|public); personal `in:` (bookmarked|watching|tracking|muted|pinned); dates: created/activity/latest-post-(before|after) with `YYYY-MM-DD` or relative days `N`; numeric: likes[-op]-(min|max), posts-(min|max), posters-(min|max), views-(min|max); order: activity|created|latest-post|likes|likes-op|posters|title|views|category with optional `-asc`; free text terms are matched.
- `discourse_get_chat_messages`
  - Input: `{ channel_id: number; page_size?: number (1–50, default 50); target_message_id?: number; direction?: "past" | "future"; target_date?: string (ISO 8601) }`
  - Output: `{ channel_id, messages: [{id, username, created_at, message, edited, thread_id, in_reply_to_id}], meta }`
- `discourse_get_draft`
  - Input: `{ draft_key: string; sequence?: number }`
  - Output: `{ draft_key, sequence, found, data: {title, reply, category_id, tags, action} }`
- `discourse_save_draft` (only when writes enabled; see Write safety)
  - Input: `{ draft_key: string; reply: string; title?: string; category_id?: number; tags?: string[]; sequence?: number (default 0); action?: "createTopic" | "reply" | "edit" | "privateMessage" }`
  - Output: `{ draft_key, sequence, saved }`
- `discourse_delete_draft` (only when writes enabled; see Write safety)
  - Input: `{ draft_key: string; sequence: number }`
  - Output: `{ draft_key, deleted }`
- `discourse_create_post` (only when writes enabled; see Write safety)
  - Input: `{ topic_id: number; raw: string (<= 30k chars); author_username?: string }`
  - Output: `{ id, topic_id, post_number }`
- `discourse_create_topic` (only when writes enabled; see Write safety)
  - Input: `{ title: string; raw: string (<= 30k chars); category_id?: number; tags?: string[]; author_username?: string }`
  - Output: `{ id, topic_id, slug, title }`
- `discourse_update_topic` (only when writes enabled; see Write safety)
  - Input: `{ topic_id: number; title?: string; category_id?: number; tags?: string[]; featured_link?: string; original_title?: string; original_tags?: string[] }`
  - Output: `{ success, topic_id, updated_fields, topic: {id, title, slug, category_id, tags, featured_link} }`
- `discourse_list_users` (requires admin API key)
  - Input: `{ query?: "active"|"new"|"staff"|"suspended"|"silenced"|"pending"|"staged"; filter?: string; order?: "created"|"last_emailed"|"seen"|"username"|"trust_level"|"days_visited"|"posts"; asc?: boolean; page?: number }`
  - Output: `{ users: [{id, username, name, email, avatar_template, trust_level, created_at, last_seen_at, admin, moderator, suspended, silenced}], meta: {page, has_more} }`
  - Note: Returns ~100 users per page (Discourse's fixed page size). `avatar_template` contains `{size}` placeholder - replace with pixel size (e.g., 120) to get avatar URL
- `discourse_create_user` (only when writes enabled; see Write safety)
  - Input: `{ username: string (1-20 chars); email: string; name: string; password: string; active?: boolean; approved?: boolean; upload_id?: number }`
  - Output: `{ success, username, name, email, active, avatar_updated, message, avatar_error? }`
  - Note: If `upload_id` is provided but avatar update fails, `avatar_error` contains the error message
- `discourse_update_user` (only when writes enabled; see Write safety)
  - Input: `{ username: string; name?: string; bio_raw?: string; location?: string; website?: string; title?: string; date_of_birth?: string; locale?: string; profile_background_upload_url?: string; card_background_upload_url?: string; upload_id?: number }`
  - Output: `{ success, username, updated_fields, avatar_updated, user: {...}, avatar_error? }`
  - Note: If `upload_id` is provided but avatar update fails, `avatar_error` contains the error message
- `discourse_upload_file` (only when writes enabled; see Write safety)
  - Input: `{ upload_type: "avatar"|"profile_background"|"card_background"|"composer"; image_data?: string (base64); url?: string; filename?: string; user_id?: number }`
  - Output: `{ id, url, short_url, short_path, original_filename, extension, width, height, filesize, human_filesize }`
  - Constraints:
    - Provide exactly one of: `image_data` (requires `filename`), remote HTTP(S) URL, or absolute local file path
    - `user_id` is required for avatar/profile_background/card_background uploads
    - Local file uploads require `--allowed_upload_paths` configuration (security: prevents arbitrary file reads)
  - Note: Use `short_url` (e.g., `upload://abc123.png`) to embed images in posts.
- `discourse_create_category` (only when writes enabled; see Write safety)
  - Input: `{ name: string; color?: hex; text_color?: hex; emoji?: string; icon?: string; parent_category_id?: number; description?: string }`
  - Output: `{ id, slug, name }`
- `discourse_select_site` (hidden when `--site` is provided)
  - Input: `{ site: string }`
  - Output: `{ site, title }`

## Development

- **Requirements**: Node >= 24, `pnpm`.

- **Install / Build / Typecheck / Test**

```bash
pnpm install
pnpm typecheck
pnpm build
pnpm test
```

- **Run locally (with source maps)**

```bash
pnpm build && pnpm dev
```

- **Project layout**

  - Server & CLI: `src/index.ts`
  - HTTP client: `src/http/client.ts`
  - Tool registry: `src/tools/registry.ts`
  - Resource registry: `src/resources/registry.ts`
  - Built‑in tools: `src/tools/builtin/*`
  - Remote tools: `src/tools/remote/tool_exec_api.ts`
  - JSON helpers: `src/util/json_response.ts`
  - Logging/redaction: `src/util/logger.ts`, `src/util/redact.ts`

- **Testing notes**

  - Tests run with Node’s test runner against compiled artifacts (`dist/test/**/*.js`). Ensure `pnpm build` before `pnpm test` if invoking scripts individually.

- **Publishing (optional)**

  - The package is published as `@discourse/mcp` and exposes a `bin` named `discourse-mcp`. Prefer `npx @discourse/mcp@latest` for frictionless usage.

- **Conventions**
  - All outputs are JSON-only for reliable programmatic parsing by agents.
  - Be careful with write operations; keep them opt‑in and rate‑limited.

See `AGENTS.md` for additional guidance on using this server from agent frameworks.

## Examples

### Quick Start with User API Key (No Admin Required)

```bash
# Step 1: Generate a User API Key
npx @discourse/mcp@latest generate-user-api-key \
  --site https://discourse.example.com \
  --save-to profile.json

# Step 2: Visit the authorization URL shown, approve the request, and paste the payload

# Step 3: Run the MCP server with your new key
npx @discourse/mcp@latest --profile profile.json --allow_writes --read_only=false
```

### Other Examples

- Read‑only session against `try.discourse.org`:

```bash
npx -y @discourse/mcp@latest --log_level debug
# In client: call discourse_select_site with {"site":"https://try.discourse.org"}
```

- Tether to a single site:

```bash
npx -y @discourse/mcp@latest --site https://try.discourse.org
```

- Create a post with Admin API Key (writes enabled):

```bash
npx -y @discourse/mcp@latest --allow_writes --read_only=false --auth_pairs '[{"site":"https://try.discourse.org","api_key":"'$DISCOURSE_API_KEY'","api_username":"system"}]'
```

- Create a post with User API Key (writes enabled, no admin required):

```bash
npx -y @discourse/mcp@latest --allow_writes --read_only=false --auth_pairs '[{"site":"https://try.discourse.org","user_api_key":"'$DISCOURSE_USER_API_KEY'"}]'
```

- Create a category (writes enabled):

```bash
npx -y @discourse/mcp@latest --allow_writes --read_only=false --auth_pairs '[{"site":"https://try.discourse.org","api_key":"'$DISCOURSE_API_KEY'","api_username":"system"}]'
# In your MCP client, call discourse_create_category with for example:
# { "name": "AI Research", "color": "0088CC", "text_color": "FFFFFF", "description": "Discussions about AI research" }
```

- Create a topic (writes enabled):

```bash
npx -y @discourse/mcp@latest --allow_writes --read_only=false --auth_pairs '[{"site":"https://try.discourse.org","api_key":"'$DISCOURSE_API_KEY'","api_username":"system"}]'
# In your MCP client, call discourse_create_topic, for example:
# { "title": "Agentic workflows", "raw": "Let's discuss agent workflows.", "category_id": 1, "tags": ["ai","agents"] }
```

- Run with HTTP transport (on port 3000):

```bash
npx -y @discourse/mcp@latest --transport http --port 3000 --site https://try.discourse.org
# Server will start on http://localhost:3000
# Health check: http://localhost:3000/health
# MCP endpoint: http://localhost:3000/mcp
```

- Connect to a site behind HTTP Basic Auth:

```bash
npx -y @discourse/mcp@latest --auth_pairs '[{"site":"https://protected.example.com","api_key":"'$DISCOURSE_API_KEY'","api_username":"system","http_basic_user":"username","http_basic_pass":"password"}]' --site https://protected.example.com
```

## Authentication

### Admin API Keys vs User API Keys

This MCP server supports two types of Discourse API authentication:

1. **Admin API Keys** (`api_key` + `api_username`)

   - Require admin/moderator permissions to generate
   - Created via Admin Panel → API → New API Key
   - Can perform all operations including user/category creation
   - Use headers: `Api-Key` and `Api-Username`

2. **User API Keys** (`user_api_key` + optional `user_api_client_id`)
   - Can be generated by any user (no admin required)
   - User-specific permissions and rate limits
   - Ideal for personal use and non-admin operations
   - Use headers: `User-Api-Key` and `User-Api-Client-Id`
   - Auto-expire after 180 days of inactivity (configurable per site)
   - Learn more: https://meta.discourse.org/t/user-api-keys-specification/48536

### Obtaining a User API Key

#### Easy Method: Built-in Generator (Recommended)

This package includes a convenient command to generate User API Keys:

```bash
# Interactive mode - follow the prompts
npx @discourse/mcp@latest generate-user-api-key --site https://discourse.example.com

# Save directly to a profile file
npx @discourse/mcp@latest generate-user-api-key --site https://discourse.example.com --save-to profile.json

# Specify custom scopes
npx @discourse/mcp@latest generate-user-api-key --site https://discourse.example.com --scopes "read,write,notifications"

# Get help
npx @discourse/mcp@latest generate-user-api-key --help
```

The command will:

1. Generate an RSA key pair
2. Display an authorization URL for you to visit
3. Prompt you to paste the encrypted payload after authorization
4. Decrypt and display your User API Key
5. Optionally save it to a profile file

#### Manual Method

User API Keys require an OAuth-like flow documented at https://meta.discourse.org/t/user-api-keys-specification/48536. Key steps:

1. Generate a public/private key pair
2. Request authorization via `/user-api-key/new` with your public key, application name, client ID, and requested scopes
3. User approves the request (after login if needed)
4. Discourse returns an encrypted payload with the User API Key
5. Decrypt using your private key and use the key in your configuration

You can also manually create User API Keys via the Discourse UI (if enabled by the site):

- Visit your user preferences → Security → API
- Or use third-party tools that implement the User API Key flow

## FAQ

- **Why is `create_post` missing?** You're in read‑only mode. Enable writes as described above.
- **Can I disable remote tool discovery?** Yes, run with `--tools_mode=discourse_api_only`.
- **Can I avoid exposing `discourse_select_site`?** Yes, start with `--site <url>` to tether to a single site.
- **Time outs or rate limits?** Increase `--timeout_ms`, and note built‑in retry/backoff on 429/5xx.
- **Should I use Admin API Keys or User API Keys?** Use User API Keys for personal use (no admin required). Use Admin API Keys only when you need admin-level operations or are setting up a system-wide integration.
- **Getting "fetch failed" errors?** Run with `--log_level debug` to see detailed error information including:
  - The exact URL being requested
  - HTTP status codes (response bodies are deliberately not logged because they may contain sensitive content)
  - Network-level errors (DNS, SSL/TLS, connectivity issues)
  - Retry attempts and timing
  - Timeout diagnostics
