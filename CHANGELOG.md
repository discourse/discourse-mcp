Changelog
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
