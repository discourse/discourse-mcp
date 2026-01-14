# Changelog

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
* implement Streamable HTTP transport (stateless mode) as alternative to stdio
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
