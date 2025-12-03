Changelog
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
