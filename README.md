## Discourse MCP

A Model Context Protocol (MCP) stdio server that exposes Discourse forum capabilities as tools and resources for AI agents.

- **Entry point**: `src/index.ts` → compiled to `dist/index.js` (binary name: `discourse-mcp`)
- **SDK**: `@modelcontextprotocol/sdk`
- **Node**: >= 24
- **Version**: 0.2.9 (0.2.x has breaking changes from 0.1.x, including JSON-only tool output; category/group resources remain deprecated compatibility surfaces alongside canonical list tools)

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
  - Built-in write tools are only registered when `--allow_writes` is enabled **and** `--read_only=false`. This includes post, topic, private-message, category, user, upload, draft, and saved Data Explorer query mutations.
  - Private-message listing and reading also require a matching authenticated site because PM data is never public.
  - Toolset selection does not bypass write safety. A selected write tool remains absent unless writes are enabled.
  - Write tools require a matching `auth_pairs` entry for the selected site; otherwise they return an error.
  - A ~1 req/sec rate limit is enforced for write actions.

- **Flags & defaults**

  - `--help`, `-h`, or positional `help`: print current CLI help and exit successfully before loading profiles or starting a transport.
  - `--version`, `-v`, or positional `version`: print one package-version line and exit successfully. `-v` means version; logging verbosity uses `--log_level`.

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
  - `--toolsets <name[,name...]>`: Expose selected built-in domains. Omit for the compact default catalog (all non-opt-in domains); use `--toolsets all` to include opt-in category/group/tag-group, moderation, workflow, and AI administration domains. See [Built-in toolsets](#built-in-toolsets).
  - `--site <url>`: Tether MCP to a single site and hide `discourse_select_site`.
  - `--default-search <prefix>`: Unconditionally prefix every search query (e.g., `tag:ai order:latest`).
  - `--max-read-length <number>`: Maximum characters returned for post content (default 50000). Applies to `discourse_read_post` and per-post content in `discourse_read_topic` and `discourse_read_private_message`. The tools prefer `raw` content by requesting `include_raw=true`.
  - `--allowed_upload_paths <paths>`: Comma-separated list or JSON array of directories allowed for local file uploads. Required to enable local file uploads in `discourse_upload_file`. Example: `--allowed_upload_paths "/home/user/images,/tmp/uploads"` or `--allowed_upload_paths '["/home/user/images"]'`. These security-sensitive paths do **not** receive `~` expansion.
  - `--transport <stdio|http>` (default: stdio): Use standard input/output by default, or loopback-only Streamable HTTP with JSON responses. HTTP explicitly supports one stateful MCP client/session per process. Every post-initialize request must carry the returned `Mcp-Session-Id`; a second initialize is rejected. After session DELETE/close, restart the process before connecting another client. `/health` returns `503 restart_required` in that closed state. Request bodies are bounded to 4 MiB.
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
# Current-user home expansion is also supported:
node dist/index.js --profile ~/discourse-mcp-profile.json
```

Flags still override values from the profile. A leading current-user `~`, `~/`, or `~\` in the **profile path** expands to the current home directory; `~otheruser`, shell-style expansion elsewhere, and upload-allowlist expansion are intentionally unsupported.

### Built-in toolsets

Toolsets let an operator expose only the built-in domains needed by an MCP client. They are optional: when `--toolsets` and the profile field are both omitted, the server registers the default catalog (including `search`, `discourse_search`, and `discourse_filter_topics`). Administrative and specialized domains marked *(opt-in)* below—including `themes`—must be selected explicitly. Use `--toolsets all` only when every built-in domain is deliberately required.

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
| `search` | Topic-level search/filtering plus post-level keyword evidence |
| `topics` | Core topic/post reads, exact stream selection, post search, user-post activity, and mutations |
| `users` | User lookup/listing, user-post activity, and user mutations |
| `chat` | Chat message retrieval |
| `drafts` | Draft retrieval, save, and deletion |
| `uploads` | File upload |
| `data_explorer` | Query retrieval, execution, creation, update, and deletion |
| `private_messages` | Authenticated personal/group PM listing and reading, plus write-gated creation, replies, and participant invitations |
| `activity` *(opt-in)* | Reply relationships, site-wide post activity, topic view history, user activity summaries and timelines, and directory/cohort metrics |
| `administration` *(opt-in)* | Category discovery, admin-visible site settings, and explicitly confirmed user activation/approval state changes |
| `site_settings` *(opt-in, admin-sensitive)* | Masked site-setting inspection plus write-gated, preflighted updates of ordinary non-secret settings |
| `webhooks` *(opt-in, admin-sensitive)* | Safe webhook and delivery-history inspection plus write-gated lifecycle, ping, and single-event redelivery operations |
| `themes` *(opt-in, admin-sensitive)* | Theme/component inspection plus write-gated local creation, editing, installation, remote synchronization, asset upload, and guarded deletion |
| `groups` *(opt-in)* | Exhaustive empty-input group directory listing, explicit page/filter compatibility mode, complete group CRUD and membership operations, and fixed-page group-authored post evidence |
| `tag_groups` *(opt-in, staff-sensitive)* | Public visibility-filtered search plus staff inventory/detail and write-gated, preflighted create/update/delete lifecycle |
| `moderation` *(opt-in)* | Authenticated review queue triage, user behavioral counters, bounded post revisions, and one freshly preflighted reviewable action |
| `workflows` *(opt-in)* | Admin-only workflow discovery, graph authoring, expression evaluation, pin-data, draft runs, step runs, executions, and version management |
| `ai_agents` *(opt-in)* | Admin-only AI agent discovery, typed lifecycle, bot-user creation, and portable import/export |
| `ai_custom_tools` *(opt-in)* | Admin-only database-backed scripted custom-tool guide, lifecycle, actual execution testing, and import/export |
| `ai_features` *(opt-in)* | Admin-only AI feature discovery and exact-area, non-secret feature-setting updates; also includes agent discovery |
| `analytics` *(opt-in)* | Staff-visible Discourse report discovery/execution and the Discourse Solved support dashboard |
| `ai_insights` *(opt-in)* | Read-oriented Discourse AI cached summaries, semantic search, and staff sentiment classifications |
| `all` *(sentinel)* | Expands to every built-in toolset, including opt-in domains; absorbs other selections |

Toolset membership is intentionally separate from safety and authorization:

- Selected toolsets form a union. A tool in multiple selected sets is registered once, in the canonical built-in order. `all` expands to every real domain and is never tool metadata.
- Omitted selection excludes opt-in-only tools. Tool definitions may not mix opt-in and default memberships, which prevents accidental default exposure.
- `discourse_select_site` is automatically retained as a bootstrap capability for every untethered subset. With `--site`, it remains hidden as usual.
- Read-only mode still removes tools that require write enablement. For example, `--toolsets data_explorer` exposes query retrieval and execution by default; add both `--allow_writes` and `--read_only=false` to expose saved-query mutations.
- Existing call-time authentication and admin checks are unchanged. Data Explorer tools still require admin access when called; group operations retain Discourse's own staff, owner, visibility, and self-service authorization rules.
- Toolsets filter **built-in tools only; they are not an authorization or complete capability boundary**. MCP resources and prompts remain available, and all existing call-time access checks remain authoritative. Remote Tool Execution API discovery is controlled independently by `--tools_mode`; use `--tools_mode discourse_api_only` when the MCP tool list must contain only the selected built-in domains. The server logs an informational notice when selected toolsets are combined with remote discovery.
- A selected domain can contribute no tools under the current safety configuration—for example, `uploads` in read-only mode. The server logs an informational notice when this occurs.
- Unknown or empty toolset selections are configuration errors. Values are de-duplicated after trimming whitespace.

#### Category, group, and tag-group directories

Directory capabilities are deliberately opt-in, so omitting `--toolsets` adds **zero** category/group/tag-group tools:

- Select `administration` for `discourse_list_categories`. Empty input performs bounded exhaustive traversal through the 1-based category-search endpoint when the deployment permits it. If anonymous POST is rejected, bounded paginated nested category-index GETs (and only on their rejection, legacy `/site.json`) are returned with explicit `anonymous_fallback`/`legacy_site_json` incomplete metadata—never as exhaustive. Optional `term`, `max_pages`, `max_requests`, `max_results`, and `deadline_ms` bound focused discovery; fallback term matching is applied locally because category index does not implement search terms. Category records retain URL/hierarchy fields; `parent_category_id` is canonical and nullable, while `pid` is a legacy alias retained for compatibility. The existing rich no-input projection is intentional: the reproducible 300-record fixture in `src/test/directory_tools.test.ts` measures about 45 KB, so this release preserves its useful counts/access fields rather than adding a second `fields` contract.
- Select `groups` for `discourse_list_groups`. `{}` is the canonical exhaustive, deduplicating operation. Supplying any explicit existing key—including `{ "page": 0 }` or `{ "asc": false }`—preserves the historical one-page/filter query behavior. Both modes return `{ groups, meta, extras?, total_rows_groups?, load_more_groups? }`; filtered mode is intentionally `complete: false`.
- Directory and tag-group successes advertise MCP `outputSchema` and return `structuredContent`. The JSON text content is the same normalized value for clients that do not consume structured output. Malformed upstream records return ordinary `isError: true` tool results rather than protocol output-validation failures.

Select the dedicated `tag_groups` domain for six tools:

1. `discourse_search_tag_groups` is public, Guardian-filtered discovery. It always sends an explicit limit and reports possible truncation. Search omits tag-group IDs, parents, and permissions, so it is not authoritative inventory; case-insensitive exact group names are the correlation key. `q` and `names` combine with AND semantics, and upstream treats `%`/`_` as SQL LIKE wildcards.
2. `discourse_list_tag_groups` and `discourse_get_tag_group` require configured API credential shape plus upstream **staff** authority. The local helper cannot prove a staff role; Discourse is authoritative and privacy-preservingly returns 404 to non-staff. Reads can work when tagging is disabled.
3. `discourse_create_tag_group`, `discourse_update_tag_group`, and `discourse_delete_tag_group` additionally require effective write mode and upstream `tagging_enabled`. MCP inputs and normalized outputs represent permissions as explicit entries, for example `[{"group_id":0,"access":"full"},{"group_id":9,"access":"readonly"}]`; group ID `0` is Discourse's built-in everyone group. The server converts these entries to Discourse's numeric permission map (`1` = full, `3` = readonly) only at the HTTP boundary. `parent_tag` is an optional `{id}` or `{name}` selector: omit it or use `null` when creating without a parent; blank client placeholders are treated as omitted. New selector names require `allow_tag_creation=true` because persistent tags are created and normal indexing/plugin hooks run.
4. Updates require a fresh `expected_state_hash`, merge omitted fields locally, and send complete tags/parent/one-per-topic/permissions because partial upstream bodies clear state. Tag/parent removals, permission replacement, and possible materialization of serializer-synthesized everyone/full legacy permissions require explicit confirmations (including `acknowledge_possible_synthetic_permission_materialization`). The hash is an MCP optimistic precondition, not an upstream atomic lock; races can still occur after preflight.
5. Deletes require exact ID/name/hash plus explicit cascade and unresolved-plugin acknowledgements. Deletion cascades memberships, permissions, and category allowed/required relationships, but does not delete tags or topic-tag rows. Plugin dependency discovery is not exhaustive. Discourse's scoped API-key action map may not authorize delete. A 200 acknowledgement is not success until a post-delete GET proves absence; uncertain post-dispatch outcomes are non-retryable `outcome_unknown` errors.

These toolsets control discovery only. Staff role, Guardian visibility, scoped-key authority, write mode, and site settings remain call-time/upstream decisions.

#### Webhooks and site settings

The `webhooks` and `site_settings` toolsets are opt-in and admin-sensitive. Selecting either toolset controls discovery only—it is **not authorization**. Every call requires matching selected-site admin-style authentication, Discourse remains the final authorization and validation authority, and mutations additionally require `--allow_writes --read_only=false`. The existing site-setting read remains available through `administration`, but site-setting mutation is discoverable only through an explicit `site_settings` selection.

```bash
# Inspect safe webhook summaries and bounded delivery diagnostics
npx -y @discourse/mcp@latest --site https://forum.example.com \
  --toolsets webhooks --tools_mode discourse_api_only \
  --auth_pairs '[{"site":"https://forum.example.com","api_key":"...","api_username":"system"}]'

# Deliberately enable guarded site-wide setting changes
npx -y @discourse/mcp@latest --site https://forum.example.com \
  --toolsets site_settings --tools_mode discourse_api_only \
  --auth_pairs '[{"site":"https://forum.example.com","api_key":"...","api_username":"system"}]' \
  --allow_writes --read_only=false
```

Webhook delivery, ping, and redelivery make requests to external systems; enqueue or HTTP success does not prove that the destination processed an event correctly. Webhook secrets are never returned, URL userinfo is removed, query values are masked, and raw event headers are never passed through. Event payload/body previews require explicit sensitive-content confirmation and are bounded and credential-redacted. Bulk redelivery is intentionally unsupported.

Site settings affect the entire forum. Reads mask both upstream-secret and credential-like names; pass `overridden_only: true` to list only settings whose current value differs from the default. Updates support only one freshly visible ordinary setting at a time, require an expected current value and confirmation, and verify the result with an exact re-read. Secret/credential, upload, uploaded-image-list, and structured object settings, bulk updates, and existing-user backfills are intentionally unsupported.

#### Theme administration

The opt-in `themes` toolset is admin-sensitive and is never included in the default catalog. Read-only selection registers only `discourse_list_themes` and `discourse_get_theme`; every mutation additionally requires `--allow_writes --read_only=false`. Toolset selection does not grant admin access: configure matching site authentication and Discourse remains authoritative for admin, repository-allowlist, dependency, compiler, import, and migration checks.

Theme HTML, JavaScript, SCSS, settings migrations, assets, and third-party repositories can execute or deploy code for every visitor. The tools require operation-specific confirmations, but they do not sandbox, validate, or declare third-party code safe. Local archives and assets are accepted only from bounded base64 input or regular files beneath symlink-resolved `--allowed_upload_paths` roots.

Use deliberate operator configuration rather than enabling every toolset:

```bash
discourse-mcp \
  --toolsets themes \
  --site https://forum.example.com \
  --auth_pairs '[{"site":"https://forum.example.com","api_key":"...","api_username":"system"}]' \
  --allow_writes \
  --read_only=false \
  --allowed_upload_paths /srv/discourse-theme-inputs
```

Local themes and ZIP-imported themes can be edited directly (although ZIP source values are omitted by Discourse's detail serializer); Git-backed themes must be changed in their repository and synchronized. Components cannot be default/user-selectable or own color schemes. Text fields and upload fields are separate schema variants—never send placeholder upload IDs with SCSS/HTML/JavaScript:

```json
{
  "fields": [{
    "name": "scss",
    "target": "common",
    "operation": "replace",
    "type": "scss",
    "value": "body { background: #241914; }"
  }]
}
```

Installation likewise uses one nested source variant. A repository install needs no archive placeholders:

```json
{
  "source": {
    "kind": "repository",
    "remote_url": "https://github.com/example/discourse-theme.git",
    "branch": "main"
  },
  "confirm_external_code": true
}
```

This release intentionally excludes private-repository key management, repository repointing, export, bulk deletion, arbitrary themeable site-setting mutation, and generic controller parameter pass-through.

#### Group management

The opt-in `groups` toolset covers the complete custom-group lifecycle: directory listing and full detail reads; create, update, and permanent delete; paginated member and owner reads; explicit selector-specific tools for adding/removing members and promoting/demoting owners by username, numeric user ID, or existing-account email; pending-request listing and approve/deny decisions; and authenticated request, public-join, and public-leave flows. A separate invitation tool handles addresses that may not have accounts yet, avoiding confusion between account lookup and forum invitations.

All mutations require both `--allow_writes` and `--read_only=false`. Creation and deletion additionally require staff/admin-style API credentials at the MCP access gate. Discourse remains authoritative for Guardian checks, group visibility, staff versus owner capabilities, automatic-group restrictions, membership settings, invitation limits, and the fields a caller may update. Core automatic groups cannot be created, deleted, or have membership/ownership changed; their permitted presentation and interaction settings can still be updated by authorized staff. Selecting the toolset does not grant any of these permissions.

#### Moderation queue

The opt-in `moderation` toolset exposes `discourse_get_review_queue_count`, `discourse_list_reviewables`, `discourse_list_reviewable_topics`, and `discourse_get_reviewable` in read-only mode. These tools require configured authentication, but intentionally do not impose an MCP admin-only gate: Discourse Guardian remains authoritative for staff and category-moderator visibility. Selecting the toolset grants no moderation permission.

For queue totals, use `discourse_get_review_queue_count`; its `count` is the number of pending **reviewable records** visible to the caller, not the number of individual flags. Use `discourse_list_reviewables` with only `status: "pending"` and `offset: 0` for ordinary triage—do not invent topic, category, type, or user filters—and follow `next_offset` until `has_more` is false. Numeric topic/category placeholders of `0` and optional text placeholders of blank/`all`/`any` are treated as omitted, so strict-schema clients cannot accidentally filter to ID 1 or send invalid universal sentinels. List results already contain bounded evidence and dynamic actions; avoid fanning out `discourse_read_topic` or detail calls across the queue. `discourse_list_reviewable_topics` is only a convenience aggregation: upstream includes pending topics at or above its minimum review-priority threshold, omits queue items without topics, and reports `score_count` as the number of review score/flag records—not reviewable items. It must not be used to infer the complete queue size.

When both `--allow_writes` and `--read_only=false` are set, `discourse_perform_reviewable_action` is also registered. Call list/detail first and submit one exact `available_actions[].id` with `confirm: true`; choose from the full action description, not a repeated label such as “Delete post.” Discourse UI action IDs can be prefixed (`post-…` or `user-…`), while the route requires the associated `server_action`; the MCP validates and maps this automatically. Moderation mutations are serialized and paced across the complete fresh-GET/PUT operation, so a concurrent model batch cannot bypass the write throttle. The tool checks an optional expected version, rejects unadvertised fields, and returns normalized success/count fields. A failure after the PUT is marked as an unknown outcome with identifiers and must be verified rather than blindly retried. Discourse still enforces claims, optimistic conflicts, action validity, and Guardian permissions. The tools expose evidence and explicit operations; they do not recommend moderation decisions.

#### Private messages

The default `private_messages` toolset provides a PM-aware interface rather than reusing generic public-topic mutations. Listing and reading require configured authentication. Creation, replies, and invitations additionally require both `--allow_writes` and `--read_only=false`. Discourse remains authoritative for mailbox visibility, PM membership, recipient limits, group messageability, and all Guardian/API-key checks.

Personal mailboxes support `inbox`, `sent`, `archive`, `unread`, and `new`. Group mailboxes support all except `sent`; a personal inbox does not include every group inbox. If `discourse_list_private_messages` omits `username`, it resolves the authenticated user through `/session/current.json`. A supplied username selects a mailbox path—it does not impersonate that user. Discourse permits another user's inbox/sent/archive only where its authorization rules allow it, while `unread` and `new` remain owner-only even for admins.

PM recipients are typed as usernames, group names, or email addresses. During creation, a messageable group wins over a same-named user in Discourse's upstream classification. A nonexistent or non-messageable `group_names` value can therefore surface as a user-not-found-style upstream error. Unknown email recipients may immediately create staged users when site settings and sender permissions allow it; use a canonical username when staged-user creation is not intended.

Email invitations are intentionally opaque. A successful response does **not** confirm delivery or immediate participant access: an address belonging to an existing account may produce a successful no-op, while a new address receives access only after invitation redemption. Use `username` to add a known account immediately. Group invitation lookup is exact-case, so use the canonical group name. Optional `author_username` sends `Api-Username`; switching identities is supported only by an appropriate global API key, while User API Keys remain bound to their owner.

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

The agent index is intentionally concise by default: `discourse_ai_list_agents` omits system prompts and per-agent configuration, returning summary counts—including `subagent_count`—plus slim tool/model catalogs. Use `discourse_ai_get_agent` with an ID to inspect one full configuration. `view: "full"` is available only for clients that explicitly need the complete upstream index.

Agent create/update schemas accept `subagent_ids`, an ordered allowlist of up to 20 unique existing agent IDs that the parent may delegate to. Negative IDs are valid for system agents. Discourse validates that every ID exists, rejects self-delegation, and prevents a configured tool from colliding with the generated `spawn_agent` tool; use the full agent list or detail response to resolve IDs before writing.

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

Resources provide application-addressable static/semi-static read-only data. Category and group resources are retained as **deprecated compatibility surfaces**; their canonical model-callable replacements are the opt-in directory tools above. Other resources remain appropriate when an MCP host attaches them.

- **discourse://site/categories** *(deprecated; use `discourse_list_categories` with `--toolsets administration`)*

  - Uses the same complete bounded/cached category fetcher, then enriches permissions in bounded ID chunks.
  - Output: `{ categories: [{id, name, slug, parent_category_id, pid, read_restricted, topic_count, post_count, perms?}], meta: {total, reported_total, pages_fetched, complete, has_more, truncated_reason?} }`
  - `parent_category_id` is canonical; `pid` is a legacy compatibility alias. `perms` is an array of `{gid, perm}` where perm: 1=full, 2=create_post, 3=readonly.
  - `perms` is populated only when the selected identity can retrieve permission enrichment; otherwise it is omitted rather than fabricated.

- **discourse://site/tags**

  - List all tags with usage counts
  - Output: `{ tags: [{id, name, count}], meta: {total} }`

- **discourse://site/groups** *(deprecated; use `discourse_list_groups` with `--toolsets groups`)*

  - Uses the same complete bounded/cached exhaustive group fetcher and reports upstream failures explicitly rather than as a truthful empty site.
  - Output: `{ groups: [{id, name, automatic, user_count, vis, members_vis, mention, msg, public_admission, public_exit, allow_membership_requests}], meta: {total, reported_total, pages_fetched, complete, has_more, truncated_reason?} }`
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

## Evidence and analytics capabilities

The expanded read catalog exposes upstream evidence rather than MCP-authored judgments:

- `discourse_search` remains topic-focused. Use `discourse_search_posts` when matched posts are required: it preserves bounded post IDs **with** highlighted blurbs, authors, topics/categories, and truthful continuation. This supersedes the older proposal to add an unbounded list of bare post IDs to topic-search results. `discourse_ai_semantic_search` is a separate opt-in Discourse AI embedding search. The opt-in `activity` tool `discourse_list_latest_posts` is a fixed 50-row chronological feed with a post-ID cursor, not search.
- The default `discourse_read_topic_posts` selects exact IDs, earliest/latest posts, an around-post window, or username-filtered posts. Latest/earliest selections use at most two upstream requests and cap the selected set at 50. The opt-in `activity` tool `discourse_get_post_replies` distinguishes recursive descendant IDs, 20-row direct replies, and the site-bounded ancestor history.
- Topic and post reads preserve Discourse Solved fields when the plugin supplies them. An accepted answer is a resolution proxy, not proof that the original poster is satisfied.
- The opt-in `activity` domain contains `discourse_get_user_summary` for profile-visible aggregates, `discourse_list_user_actions` for a paginated named event timeline, and `discourse_list_directory_items` for visible directory/cohort metrics. The existing default `discourse_list_user_posts` remains the compatible post/reply view.
- The opt-in `administration` domain makes categories and admin-visible site settings model-callable and provides confirmed activation/approval state changes. User creation requires a global admin API key; responses without an upstream `user_id` remain explicitly unconfirmed.
- Topic/post `author_username` requires a global API key, and creation responses report both requested and actual attribution so ignored impersonation cannot be mistaken for success.
- The opt-in `analytics` domain discovers the staff-visible report catalog before executing a report and exposes the Solved support dashboard. Dashboard “unanswered” means unsolved with no qualifying regular reply—not no response from a designated team.
- The opt-in `ai_insights` domain requires Discourse AI. Cached summaries report staleness, semantic search remains Guardian-filtered, and sentiment values are upstream model classifications rather than objective argument, satisfaction, or risk labels.

Plugin-specific 404 responses are intentionally reported as `capability_or_resource_unavailable`: the same upstream response can mean a disabled plugin/setting, a hidden resource, or a nonexistent resource. Toolset selection does not grant visibility or staff access.

Example compositions:

1. Catch up on a thread with `discourse_read_topic_posts` in `latest`/`replies_only` mode, then let the calling model summarize the ordered evidence.
2. Assess answer state by combining Solved topic filters, accepted-answer fields, and the support dashboard while disclosing that “solved” is only a proxy.
3. Check for group participation with `discourse_list_group_posts` and topic IDs; group authorship is evidence, not proof of organizational responsibility.
4. Review possible conflict by retrieving exact posts/reply chains and, optionally, upstream sentiment classifications; the calling model makes and explains any semantic judgment.

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
  - Input: `{ filter?: string; view?: "filtered"|"top"|"hot" (default "filtered"); top_period?: "daily"|"weekly"|"monthly"|"quarterly"|"yearly"|"all"; page?: number (0-based); per_page?: number (1–50) }`
  - Filtered requires a nonblank `filter` and uses `/filter.json`. Top rejects `filter`, uses `/top.json`, and defaults to weekly. Hot rejects `filter`/`top_period` and is defined exactly as Discourse's **daily top score**—not semantic controversy, toxicity, or real-time velocity.
  - Output: `{ results: [{id, slug, title, category_id, tags, created_at, last_posted_at, bumped_at, posts_count, reply_count, views, like_count, posters_count, closed, archived, pinned, visible, last_poster_username, posters}], meta: {view, top_period, page, per_page, returned, has_more, total?} }`. Missing optional values remain `null`; `total` and continuation are never fabricated.
  - Filter query language (succinct): key:value tokens separated by spaces; category/categories (comma = OR, `=category` = without subcats, `-` prefix = exclude); tag/tags (comma = OR, `+` = AND) and tag_group; status:(open|closed|archived|listed|unlisted|public); personal `in:` (bookmarked|watching|tracking|muted|pinned); dates: created/activity/latest-post-(before|after) with `YYYY-MM-DD` or relative days `N`; numeric: likes[-op]-(min|max), posts-(min|max), posters-(min|max), views-(min|max); order: activity|created|latest-post|likes|likes-op|posters|title|views|category with optional `-asc`; free text terms are matched.
- Moderation tools *(only with `--toolsets moderation`; all require authentication)*
  - `discourse_get_review_queue_count`: `{}` → `{ count, unit: "pending_reviewable_queue_items", status: "pending", scope }`, where `count` is the authoritative number of pending reviewable records visible to the caller, not individual flags.
  - `discourse_list_reviewables`: stable review filters and offset pagination → normalized reviewables with named status plus numeric `status_id`, current versions, bounded evidence, scores, targets, and dynamic actions. For normal triage send only `status` and `offset`; use `meta.total` and follow `next_offset`. Upstream page size is fixed at 10.
  - `discourse_list_reviewable_topics`: `{}` → a non-exhaustive aggregation of pending topics at or above Discourse's minimum review priority. `score_count` counts review score/flag records, not reviewable queue items; queue items without topics are absent.
  - `discourse_get_reviewable`: `{ reviewable_id; include_explanation? }` → refreshed bounded context, side-loaded references, editable fields, score evidence, and exact available actions; no recommendation is generated. Avoid bulk fan-out because list results already contain triage evidence.
  - `discourse_perform_reviewable_action` *(only when writes enabled)*: `{ reviewable_id; action_id; expected_version?; additional_fields?; confirm: true }` → serialized, freshly preflighted action with normalized success and remaining-count fields. Submit the displayed dynamic action ID; MCP maps its `server_action` to the Discourse route.
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
- `discourse_list_private_messages` (requires authentication)
  - Input: `{ username?: string; mailbox?: "inbox"|"sent"|"archive"|"unread"|"new"; group_name?: string; page?: number (0-based, default 0); per_page?: number (1–100, default 30) }`
  - Output: `{ mailbox, username, group_name, messages: [{topic_id, slug, title, posts_count, reply_count, created_at, last_posted_at, bumped_at, last_read_post_number, unread_posts, unseen, topic_archived, message_archived, notification_level, recent_participants}], meta: {page, per_page, has_more} }`
  - Omitting `username` uses the authenticated user. Group mailboxes do not support `sent`; `unread` and `new` cannot target another user.
- `discourse_read_private_message` (requires authentication)
  - Input: `{ topic_id: number; post_limit?: number (1–50, default 5); start_post_number?: number }`
  - Output: `{ topic_id, slug, title, archetype, subtype, posts_count, last_read_post_number, topic_archived, message_archived, allowed_users, allowed_groups, posts, meta }`
  - `allowed_users` and `allowed_groups` are direct records, not an expanded ACL. Public topics are rejected.
- `discourse_create_private_message` (only when writes enabled; see Write safety)
  - Input: `{ title: string; raw: string (<= 30k chars); usernames?: string[]; group_names?: string[]; email_addresses?: string[]; author_username?: string }` (at least one recipient required)
  - Output: `{ id, topic_id, post_number, slug, title }`
  - Unknown emails may create staged users. Messageable group names take precedence over same-named usernames.
- `discourse_reply_private_message` (only when writes enabled; see Write safety)
  - Input: `{ topic_id: number; raw: string (<= 30k chars); reply_to_post_number?: number; author_username?: string }`
  - Output: `{ id, topic_id, post_number, reply_to_post_number, slug }`
  - Performs an uncached PM-archetype safety check before posting, without advancing read state.
- `discourse_invite_to_private_message` (only when writes enabled; see Write safety)
  - Input: `{ topic_id: number; username?: string; group_name?: string; email_address?: string; notify_group_members?: boolean; custom_message?: string (<= 3000 chars); author_username?: string }` (exactly one recipient required)
  - Output: immediate normalized user/group addition, or `{ topic_id, recipient_type: "email", status: "submitted", participant_added: false, outcome_confirmed: false }`
  - Email submission never claims delivery or access. `custom_message` is email-only, group notifications default to enabled, and group names are exact-case.
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
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
pnpm test
pnpm lint
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

- **Dependency and lockfile policy**

  - pnpm (`packageManager: pnpm@10.14.0`) is the authoritative development workflow, but both `pnpm-lock.yaml` and `package-lock.json` are tracked for downstream/npm compatibility. Regenerate and commit **both** whenever dependencies change; CI runs frozen pnpm and clean `npm ci` builds so neither can silently drift.
  - `@modelcontextprotocol/sdk` is intentionally pinned exactly to the reviewed `1.30.0` release. SDK updates are deliberate security/compatibility changes and must pass typecheck, real transport/output-schema tests, production high-severity audits for both lockfiles, and packaging smoke tests. Dev-only audit exceptions require a dated owner and remediation plan.

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

- Private-message workflow with authenticated list/read and write-gated create/reply/invite:

```bash
npx -y @discourse/mcp@latest \
  --site https://try.discourse.org \
  --toolsets private_messages \
  --tools_mode discourse_api_only \
  --auth_pairs '[{"site":"https://try.discourse.org","user_api_key":"'$DISCOURSE_USER_API_KEY'"}]' \
  --allow_writes --read_only=false

# In your MCP client:
# discourse_list_private_messages: { "mailbox": "inbox", "page": 0 }
# discourse_read_private_message: { "topic_id": 123, "post_limit": 10 }
# discourse_reply_private_message: { "topic_id": 123, "raw": "Here is the result.", "reply_to_post_number": 3 }
# discourse_create_private_message: { "title": "Claim review", "raw": "Please review.", "usernames": ["alice"], "group_names": ["reviewers"], "email_addresses": ["external@example.com"] }
# discourse_invite_to_private_message: { "topic_id": 123, "group_name": "reviewers", "notify_group_members": false }
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

The command uses Discourse's device authorization flow on supported sites (Discourse 2026.6.0 and newer):

1. It generates an RSA key pair and requests a short-lived authorization.
2. It displays an activation URL and a short code such as `ABCD-2345`.
3. You open the URL, enter the code, review the scopes, and authorize the request.
4. The command polls Discourse and retrieves the encrypted User API Key automatically.
5. It validates and decrypts the response, then prints the configuration or saves it to a profile.

No encrypted payload needs to be copied back into the terminal. For older Discourse sites, the command automatically falls back to the legacy authorization URL and payload prompt.

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
