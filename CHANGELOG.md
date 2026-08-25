# Changelog

## [0.3.1](https://github.com/discourse/discourse-mcp/compare/v0.3.0...v0.3.1) (2026-08-25)

### Changed

* Simplify write-mode opt-in and deprecate `read_only=false`
  - `--allow_writes` now enables mutation tools by itself; the redundant `--read_only=false` CLI/profile setting is deprecated, has no effect, and emits an informational migration notice
  - Migration note: an existing command or profile with `allow_writes=true` and no `read_only` value previously remained read-only; it now enables mutation tools as its name indicates
  - Keep writes disabled when `allow_writes` is omitted or false, and retain toolset selection, authentication, authorization, confirmation, and call-time access checks unchanged

### Breaking Changes

* Reject contradictory `allow_writes=true` and `read_only=true` configuration at startup instead of silently hiding mutation tools; remove `read_only=true` to enable writes, or remove `allow_writes=true` to remain read-only

## [0.3.0](https://github.com/discourse/discourse-mcp/compare/v0.2.9...v0.3.0) (2026-08-21)

### Features

* Complete bounded category and group directories with structured MCP output
  - Paginate lazy-loaded category/group endpoints with stable ID deduplication, cancellation/deadline/page budgets, short-lived site/auth/option-isolated caching, and truthful completeness/truncation metadata
  - Keep `discourse_list_categories` isolated to opt-in `administration`; make empty-input `discourse_list_groups` exhaustive under opt-in `groups` while preserving explicit page/filter one-request behavior
  - Add `parent_category_id` while retaining legacy `pid`, and keep deprecated category/group resources correct through shared fetchers and bounded permission enrichment
  - Advertise output schemas and identical JSON-text fallbacks; malformed upstream records now produce normal tool errors

* Add the dedicated opt-in `tag_groups` lifecycle toolset
  - Add public Guardian-filtered search, authoritative staff list/detail, deterministic optimistic state hashes, and explicit `{group_id, access}` permission entries that are machine-readable in MCP JSON Schema and converted to Discourse's numeric map only at the HTTP boundary
  - Add guarded create, complete-state update, and hard delete with local ID/name/hash preflights, tag-creation/replacement/cascade confirmations, non-retried writes, and authoritative post-state/absence verification; tolerate blank optional `parent_tag` placeholders as omission while reserving explicit `null` for update-time clearing
  - Report uncertain post-dispatch outcomes without structured success or blind-retry advice; document scoped-key, plugin-dependency, tagging-setting, and deletion-cascade limits

* Add top-level CLI metadata and cross-platform profile home expansion
  - `--help`/`-h`/`help` and `--version`/`-v`/`version` exit successfully before profile/site/transport startup
  - Expand only a leading current-user `~`, `~/`, or `~\` in profile paths; do not expand `~otheruser` or upload allowlists

* Make the loopback HTTP transport contract explicitly one stateful client per process
  - Retain random session IDs, reject missing/unknown sessions and second initialization, bound pre-read request bodies to 4 MiB, and close active transports during shutdown
  - After DELETE, expose a clear restart-required MCP/health response instead of leaving a closed transport behind a healthy endpoint

* Add opt-in, admin-sensitive `webhooks` and `site_settings` toolsets
  - Add secret-safe webhook inspection, bounded/redacted delivery diagnostics, guarded lifecycle operations, ping, and exact single-event redelivery with fresh destination preconditions and no automatic mutation retries
  - Harden site-setting reads against upstream-secret and credential-like values, support directly listing only currently overridden settings, and add one-setting-at-a-time updates with live metadata validation, expected-value conflict checks, no-retry writes, and exact verification reads
  - Keep external delivery, bulk operations, secret/structured setting mutation, user backfills, and generic admin-route passthrough outside the supported surface

* Add the opt-in, admin-sensitive `themes` toolset
  - Add bounded list/detail reads and write-gated local creation, metadata/composition changes, field/setting/translation editing, Git/archive installation, remote synchronization, asset upload, and guarded single deletion
  - Require explicit confirmations for executable code, migrations, default and component-graph changes, source replacement, archive replacement, forced placeholders, reverts, uploads, and deletion
  - Keep local files beneath symlink-resolved `allowed_upload_paths`, bound source/archive/asset responses, redact credentials and private-key-like data, and avoid retries for multipart and non-idempotent create/delete requests
  - Advertise mutually exclusive text/upload/delete field variants and nested repository/base64-archive/path-archive variants so clients do not invent placeholder `upload_id` or archive values
  - Intentionally exclude private-repository keys, source repointing, export, bulk deletion, arbitrary themeable site-setting mutation, and generic controller pass-through

* Add a cohesive Discourse evidence and analytics layer
  - Add bounded topic-stream selection, reply relationships, latest-post feeds, post-level search, and daily topic view statistics with truthful upstream cursor and limit semantics
  - Keep only topic-stream selection and post-level search default-on; expose deeper reply, feed, view, user-summary, action-timeline, and directory reads through the opt-in `activity` toolset
  - Add opt-in `administration` discovery for categories and site settings plus explicitly confirmed user activation/approval actions
  - Make acting-user writes require a global API key and report actual attribution; treat signup anti-enumeration responses as unconfirmed instead of inventing created users
  - Preserve conditional Discourse Solved topic/post fields and keep accepted answers explicitly framed as a resolution proxy
  - Add profile-visible user summaries, named action timelines, directory/cohort metrics, group-authored post evidence, staff moderation counters, and bounded post revisions
  - Add opt-in `analytics` report discovery/execution and the Discourse Solved support dashboard without arbitrary SQL or customer-specific rules
  - Add opt-in `ai_insights` cached summaries, semantic search, and staff sentiment reads while labeling AI output as upstream classification rather than objective judgment
  - Share bounded, privacy-conscious post/topic/user projections; pace fan-out reads per selected site; and return structured status/plugin diagnostics without leaking upstream bodies
  - Keep existing tool names and response contracts compatible, retain write gates, and update catalog/toolset contract coverage

* Enrich topic discovery and add authoritative top/hot views to `discourse_filter_topics`
  - Preserve existing filtered calls while adding top periods and defining hot exactly as Discourse's daily top score
  - Return uniform rich topic metadata with null-safe fields and pagination totals/continuation only when authoritative
  - Keep `search` default-on and both search tools available in read-only mode

* Add the opt-in `moderation` toolset for Discourse's review queue
  - Inspect queue count, reviewables, high-priority reviewable-topic aggregation, full bounded context, score explanations, and dynamic available actions
  - Distinguish pending reviewable totals from individual score/flag records and mark the topic aggregation as non-exhaustive
  - Support staff and category moderators through authenticated reads while leaving Guardian permissions authoritative
  - Add one write-gated action tool with fresh-action preflight, optimistic-version checks, explicit confirmation, contracted fields, and structured moderation errors
  - Mark reads and destructive actions accurately in MCP metadata, make strict-schema numeric placeholders safe, and normalize statuses/count units
  - Serialize concurrent moderation mutations, pace high-volume reads, route prefixed UI action IDs through their authoritative `server_action`, and report ambiguous post-PUT failures without encouraging blind retries

* Use Discourse's device authorization flow when generating User API Keys
  - Show a short browser activation code and poll for approval automatically
  - Use RSA-OAEP encryption and validate the response nonce
  - Fall back to the legacy copy-and-paste flow on older Discourse sites

* Add typed built-in toolsets and `--toolsets <name[,name...]>` selection
  - Filter built-in tools by operator-facing domains while preserving canonical registration order
  - Keep site selection, write enablement, and call-time authorization as independent safety controls
  - Support comma-separated CLI values and string or array profile configuration
  - Treat omitted selection as the non-opt-in default catalog and add `--toolsets all` for every domain

* Add the opt-in `groups` toolset for complete group lifecycle management
  - List and inspect groups, members, owners, and pending membership requests with upstream visibility and pagination semantics
  - Create, fully configure, update, and delete custom groups, including notification defaults, associations, email settings, custom fields, and plugin extensions
  - Use separate, unambiguous mutation tools for usernames, numeric user IDs, existing-account emails, and unknown-address invitations instead of mirroring Discourse's selector precedence
  - Bulk-add and remove members, promote and demote owners, approve or deny requests, and support request/join/leave self-service flows
  - Preserve write gating and Discourse's staff, owner, Guardian, automatic-group, invitation, and membership-setting restrictions

* Add the opt-in `workflows` toolset for the experimental `discourse-workflows` plugin
  - Discover workflows, node types, templates, credentials, executions, versions, and related forum entities
  - Create and replace complete graphs with paired graph safety and a flat connection adapter
  - Apply mechanical MCP-side graph operations after a fresh GET, then publish, unpublish, discard, delete, or restore drafts
  - Evaluate expressions, manage pin-data, step-run or manually run the current draft, and poll asynchronous executions

* Add opt-in Discourse AI administration toolsets
  - Add typed AI-agent discovery, lifecycle management, bot-user creation, and portable import/export through `ai_agents`
  - Add scripted custom-tool discovery, lifecycle, focused authoring guidance, execution testing, and import/export through `ai_custom_tools`
  - Add exact-area, non-secret AI feature discovery and updates through `ai_features`
  - Keep all three domains default-off, require admin authority, and retain write gating for mutations and custom-tool execution
  - Accept ordered `subagent_ids` allowlists on agent creation and partial updates, including negative system-agent IDs
  - Match Discourse's limit of 20 unique subagents and expose `subagent_count` in slim agent listings

* Add the default `private_messages` toolset for authenticated PM lifecycle operations
  - List personal and group inbox/archive/unread/new mailboxes, plus personal sent messages, with uncached identity-safe reads
  - Read PM-specific metadata, direct allowed-user/group records, reply relationships, and bounded post bodies while rejecting public topics
  - Create PMs for typed user, group, and email recipients and safely reply only after a PM-archetype preflight
  - Invite users, groups, or email addresses with correct group notification serialization and intentionally conservative email outcome reporting
  - Preserve Discourse authorization, write gating, API-key identity rules, recipient limits, and Guardian checks

### Security

* Stop logging HTTP response bodies, including at debug level, because administration APIs may return secrets or other sensitive content

### Bug Fixes

* Treat successful empty `204 No Content` responses as valid results for delete operations

### Maintenance

* Pin `@modelcontextprotocol/sdk` exactly to reviewed version 1.30.0 and harden dual-lockfile packaging
  - Keep pnpm authoritative while regenerating/tracking `package-lock.json`; CI now verifies frozen pnpm and clean npm installs, typecheck/build/tests, production audits, package contents, and CLI metadata smoke tests
  - Upgrade Zod, TypeScript, ESLint, and supporting type packages while preserving the modern remote-tool callback/content compatibility fixes and rejecting the vulnerable SDK 1.17.x downgrade

* Simplify built-in tool registration with typed `defineTool()` definitions and one ordered catalog
  - Preserve existing MCP names, metadata, schemas, handlers, registration order, and availability
  - Add compile-time inference fixtures and catalog/registration contract tests

## [0.2.9](https://github.com/discourse/discourse-mcp/compare/v0.2.8...v0.2.9) (2026-07-03)

### Security

* Restrict HTTP transport to local callers
  - Bind HTTP transport to loopback and reject non-local Host/Origin headers

## [0.2.8](https://github.com/discourse/discourse-mcp/compare/v0.2.7...v0.2.8) (2026-05-11)

### Bug Fixes

* Support Discourse installations served from a subfolder such as `https://example.com/forum`
  - Preserve the path component when normalizing `--site` and `auth_pairs` site URLs
  - Route leading-slash API paths like `/about.json` and `/search.json` under the configured subfolder
  - Keep root-site behavior unchanged for sites hosted at the domain root

## [0.2.7](https://github.com/discourse/discourse-mcp/compare/v0.2.6...v0.2.7) (2026-03-31)

### Features

* Add `discourse_update_post` tool to edit existing post content
  - Update post body via `PUT /posts/:post_id.json`
  - Optional `edit_reason` parameter for edit history

## [0.2.6](https://github.com/discourse/discourse-mcp/compare/v0.2.5...v0.2.6) (2026-03-04)

### Bug Fixes

* Always register Data Explorer tools, resources, and prompts regardless of auth type
  - `prompts/list` no longer errors or returns empty for non-admin users
  - Admin access is now enforced at call time by Discourse, not at registration time
* Allow user API key auth for admin-only endpoints (Data Explorer, list_users)
  - Previously only global API keys were accepted; admin users with user API keys were blocked
  - Discourse enforces actual admin permissions server-side

## [0.2.5](https://github.com/discourse/discourse-mcp/compare/v0.2.4...v0.2.5) (2026-02-03)

### Features

* Add Data Explorer plugin integration
  - `explorer_schema` resource: database schema in compact text format (core tables by default)
  - `explorer_schema_tables` resource: schema for specific or all tables
  - `explorer_queries` resource: saved queries with pagination (30/page, sorted by last used)
  - `discourse_get_query` tool: get query details including SQL and parameters
  - `discourse_run_query` tool: execute query with parameters
  - `discourse_create_query` tool: create new saved query
  - `discourse_update_query` tool: update existing query
  - `discourse_delete_query` tool: delete query
  - `sql_query` prompt: guided SQL workflow for schema discovery and query execution

## [0.2.4](https://github.com/discourse/discourse-mcp/compare/v0.2.3...v0.2.4) (2026-01-20)

### Features

* Add `discourse_list_users` tool to query and filter users (requires admin API key)
* Add `discourse_update_user` tool to update user profiles with avatar support
* Add `discourse_upload_file` tool to upload images via base64, URL, or local file
* Add `discourse_update_topic` tool to update existing topics
  - Update title, category, tags, and featured_link via `PUT /t/-/:topic_id.json`
  - Conflict detection via optional `original_title` and `original_tags` parameters
* Enhance `discourse_create_user` to accept `upload_id` for avatar setting
  - Note: `active` and `approved` default to `true` (Discourse defaults both to `false`)
  - This means users created via this tool are immediately usable without manual activation/approval

### Maintenance

* Add ESLint configuration with typescript-eslint
  - New `npm run lint` script
  - Fix existing lint issues across codebase
* Add HTTP client PUT method and multipart form data support
* Improve TypeScript types: add `ToolRegistrar` and `ResourceRegistrar` narrowed interfaces

### Bug Fixes

* Remove unused `with_private` parameter from `discourse_search` schema
* Return consistent JSON error format for input validation failures
  - Validation errors now return `{error: "Validation failed", issues: [{path, message}]}`
  - Previously threw unstructured errors that bypassed the standard error format
* Support `--flag=value` syntax in `generate-user-api-key` subcommand
  - Fixes handling of values that start with `--` (e.g., encrypted payloads)

## [0.2.3](https://github.com/discourse/discourse-mcp/compare/v0.2.2...v0.2.3) (2026-01-14)

### Bug Fixes

* Fix tags resource to include tag names alongside id and count
  - `discourse://site/tags` now returns `{id, name, count}` instead of just `{id, count}`
  - Tag `name` is the string used in filters (e.g., `tag:mcp-test`)

* Fix `discourse_list_user_posts` to always include `id` field
  - `id` is now always present (may be `null` for first posts/topic creation where `post_number: 1`)
  - Use `topic_id` + `post_number` to reference posts when `id` is `null`

* Fix `discourse_filter_topics` to respect `per_page` limit
  - Results are now properly sliced to the requested `per_page` value
  - `has_more` correctly indicates when more results are available

### Documentation

* Fix tool descriptions to accurately describe return types:
  - `discourse_filter_topics`: "Returns JSON array" → "Returns JSON object with results array"
  - `discourse_get_chat_messages`: "Returns JSON array" → "Returns JSON object with channel_id, messages array, and meta"
  - `discourse_get_user`: Added missing `admin, moderator` fields to description
  - `discourse_list_user_posts`: Clarified return structure with posts array and meta

* Update README.md to reflect correct output formats for tags and chat messages

## [0.2.2](https://github.com/discourse/discourse-mcp/compare/v0.2.1...v0.2.2) (2026-01-14)

### Features

* Add HTTP Basic Auth support for sites behind reverse proxies
  - New `http_basic_user` and `http_basic_pass` fields in `auth_pairs` configuration
  - Sends `Authorization: Basic` header alongside Discourse API authentication headers

## [0.2.1](https://github.com/discourse/discourse-mcp/compare/v0.1.17...v0.2.1) (2026-01-13)

### Breaking Changes

* All tool outputs now return strict JSON instead of Markdown
* List tools converted to MCP Resources (URI-addressable endpoints):
  - `discourse_list_categories` → `discourse://site/categories`
  - `discourse_list_tags` → `discourse://site/tags`
  - `discourse_list_chat_channels` → `discourse://chat/channels`
  - `discourse_list_user_chat_channels` → `discourse://user/chat-channels`
  - `discourse_list_drafts` → `discourse://user/drafts`

### Features

* Add MCP Resources for static/semi-static data (categories, tags, groups, chat channels, drafts)
* Add `discourse://site/groups` resource with visibility and membership settings
* Add lean JSON response format optimized for token efficiency
* Centralize rate limiting and JSON response builders (DRY refactor)

### [0.1.17](https://github.com/discourse/discourse-mcp/compare/v0.1.16...v0.1.17) (2026-01-12)

* Publish server to MCP registry

### [0.1.16](https://github.com/discourse/discourse-mcp/compare/v0.1.15...v0.1.16) (2025-12-30)

#### Features

* ability to create post as another user by overriding Api-Username header

#### Breaking Changes

* remove `author_user_id` param from discourse_create_post tool
* remove `author_user_id` param from discourse_create_topic tool

### [0.1.15](https://github.com/discourse/discourse-mcp/compare/v0.1.14...v0.1.15) (2025-12-26)

#### Features

* add support for `emoji` and `icon` params in discourse_create_category tool
* add support for `author_username` and `author_user_id` params in discourse_create_post tool
* add support for `author_username` and `author_user_id` params in discourse_create_topic tool

### [0.1.14](https://github.com/discourse/discourse-mcp/compare/v0.1.13...v0.1.14) (2025-12-19)

#### Features

* change github link in the User Agent string 

### [0.1.13](https://github.com/discourse/discourse-mcp/compare/v0.1.12...v0.1.13) (2025-12-03)

#### Features

* add discourse_list_drafts tool to list all drafts for the current user
* add discourse_get_draft tool to retrieve a specific draft by key
* add discourse_save_draft tool to create or update drafts (requires writes enabled)
* add discourse_delete_draft tool to delete drafts (requires writes enabled)
* draft tools support new_topic, topic reply, and private message draft types
* include sequence number tracking for optimistic locking on draft updates

### [0.1.12](https://github.com/discourse/discourse-mcp/compare/v0.1.11...v0.1.12) (2025-12-03)

#### Features

* add discourse_list_chat_channels tool to list all public chat channels with filtering and pagination
* add discourse_list_user_chat_channels tool to list user's chat channels with unread tracking
* add discourse_get_chat_messages tool with flexible pagination and date-based filtering
* support directional pagination (past/future) and querying around specific dates or messages
* include smart pagination hints that guide users on how to navigate message history

### [0.1.11](https://github.com/discourse/discourse-mcp/compare/v0.1.10...v0.1.11) (2025-12-02)

#### Breaking Changes

* update minimum Node.js requirement from 18 to 24
* required due to RSA_PKCS1_PADDING deprecation in generate-user-api-key functionality
* users must upgrade to Node.js 24+ to use the User API Key generator

### [0.1.10](https://github.com/discourse/discourse-mcp/compare/v0.1.9...v0.1.10) (2025-11-11)

#### Bug Fixes

* fix start_post_number parameter in discourse_read_topic - use valid post_number API parameter instead of invalid near parameter
* fixes bug where start_post_number > 20 would return zero posts due to invalid API parameter being ignored by Discourse

### [0.1.9](https://github.com/discourse/discourse-mcp/compare/v0.1.8...v0.1.9) (2025-10-20)

#### Features

* add discourse_list_user_posts tool to fetch user posts and replies
* support pagination with page parameter (30 posts per page)
* include formatted output with topic titles, dates, excerpts, and URLs

### [0.1.8](https://github.com/SamSaffron/discourse-mcp/compare/v0.1.7...v0.1.8) (2025-10-20)

#### Features

* add User API Key support and generator
* implement User-Api-Key and User-Api-Client-Id headers for non-admin authentication
* add generate-user-api-key command with RSA keypair generation and interactive setup
* add enhanced HTTP error logging with detailed diagnostics for troubleshooting

#### Bug Fixes

* enable logger output to stderr (uncommented process.stderr.write())
* support kebab-case CLI arguments in mergeConfig (--allow-writes, --read-only, etc.)
* ensure CLI flags override profile settings regardless of case style (kebab-case or snake_case)

### [0.1.7](https://github.com/SamSaffron/discourse-mcp/compare/v0.1.6...v0.1.7) (2025-10-17)

#### Features

* add optional HTTP transport support via --transport flag
* implement Streamable HTTP transport (initially stateless; superseded in 0.3.0 by the one-stateful-session security contract) as alternative to stdio
* add --port flag for configuring HTTP server port (default: 3000)
* include health check endpoint at /health for HTTP mode

### [0.1.6](https://github.com/SamSaffron/discourse-mcp/compare/v0.1.5...v0.1.6) (2025-10-16)

#### Bug Fixes

* fix broken 0.1.5 release

### [0.1.5](https://github.com/SamSaffron/discourse-mcp/compare/v0.1.4...v0.1.5) (2025-10-16)

#### Bug Fixes

* correct filter_topics pagination to be 0-based ([2f0eb17](https://github.com/SamSaffron/discourse-mcp/commit/2f0eb17))

### [0.1.4](https://github.com/SamSaffron/discourse-mcp/compare/v0.1.3...v0.1.4) (2025-09-02)

### [0.1.3](https://github.com/SamSaffron/discourse-mcp/compare/v0.1.2...v0.1.3) (2025-08-20)

### [0.1.2](https://github.com/SamSaffron/discourse-mcp/compare/v0.1.1...v0.1.2) (2025-08-20)

### 0.1.1 (2025-08-20)
