## Discourse MCP — Agent Guide

### What this is
- **Purpose**: An MCP (Model Context Protocol) stdio server that exposes Discourse forum capabilities as tools for AI agents.
- **Entry point**: `src/index.ts` → compiled to `dist/index.js` (binary name: `discourse-mcp`).
- **SDK**: `@modelcontextprotocol/sdk`. Node ≥ 18.

### How it works
- On start, the server validates CLI flags via Zod, constructs an HTTP client, and registers tools on an MCP server named `@discourse/mcp`.
- HTTP requests target the configured Discourse site; responses are summarized for agent consumption.
- Outputs are text-oriented; some tools embed compact JSON in fenced code blocks for structured extraction.

### Authentication & permissions
- Supported auth:
  - **None** (read-only public data)
  - **Api-Key** with optional `Api-Username`
  - **User-Api-Key**
- **Writes are disabled by default**. `discourse.create_post` is only registered when all are true:
  - `--allow_writes` AND not `--read_only` AND one of `--api_key` or `--user_api_key` is provided.
- Secrets are never logged; config is redacted before logging.

### Tools exposed (built-in)
- **discourse.search**
  - **Input**: `{ query: string; with_private?: boolean; max_results?: number (1–50, default 10) }`
  - **Output**: Top topics with titles and URLs; appends a JSON footer of `{ results: [{ id, url, title }] }` inside a fenced block.
- **discourse.read_topic**
  - **Input**: `{ topic_id: number; post_limit?: number (1–20, default 5) }`
  - **Output**: Title, category, tags, and the first N posts as brief bullet summaries; includes canonical topic link.
- **discourse.read_post**
  - **Input**: `{ post_id: number }`
  - **Output**: Author, timestamp, excerpt (up to ~1200 chars), and direct link.
- **discourse.list_categories**
  - **Input**: `{}`
  - **Output**: Category names with topic counts.
- **discourse.list_tags**
  - **Input**: `{}`
  - **Output**: Tags with usage counts (or notice if tags are disabled).
- **discourse.get_user**
  - **Input**: `{ username: string }`
  - **Output**: Display name, trust level, joined date, short bio, and profile link.
- **discourse.create_post** (conditionally available; see permissions)
  - **Input**: `{ topic_id: number; raw: string (≤ 30k chars) }`
  - **Output**: Link to created post/topic. Includes a simple 1 req/sec rate limit.

### Remote Tool Execution API (optional)
- If the target Discourse site exposes an MCP-compatible Tool Execution API:
  - GET `/ai/tools` is discovered on startup when `tools_mode` is `auto` (default) or `tool_exec_api`.
  - Each remote tool is registered dynamically using its JSON Schema input.
  - Calls POST `/ai/tools/{name}/call` with `{ arguments, context: {} }`.
  - Results may include `details.artifacts[]`; links are surfaced at the end of the tool output.
- Set `--tools_mode=discourse_api_only` to disable remote tool discovery.

### CLI configuration
- **Required**: `--site <https://your.discourse.site>`
- **Optional flags**:
  - `--api_key <key>` and optionally `--api_username <name>`
  - `--user_api_key <key>` (mutually exclusive with `--api_key`)
  - `--read_only` (default true), `--allow_writes` (default false)
  - `--timeout_ms <number>` (default 15000)
  - `--concurrency <number>` (default 4)
  - `--cache_dir <path>` (currently unused; in-memory caching is built-in)
  - `--log_level <silent|error|info|debug>` (default info)
  - `--tools_mode <auto|discourse_api_only|tool_exec_api>` (default auto)
  - `--profile <path.json>`: load partial config from JSON (flags override)

### Networking & resilience
- User-Agent: `Discourse-MCP/0.x (+https://github.com/discourse-mcp)`.
- Retries on 429/5xx with backoff (3 attempts).
- Lightweight in-memory GET cache for selected endpoints (e.g., topics, site metadata).

### Errors & rate limits
- Tool failures return `isError: true` with human-readable messages.
- `discourse.create_post` enforces ~1 request/second to avoid flooding.

### Source map
- MCP server and CLI: `src/index.ts`
- HTTP client: `src/http/client.ts`
- Tool registry: `src/tools/registry.ts`
- Built-in tools: `src/tools/builtin/*`
- Remote tools: `src/tools/remote/tool_exec_api.ts`
- Logging/redaction: `src/util/logger.ts`, `src/util/redact.ts`

### Quick start (for human operators)
- Build: `pnpm build`
- Run: `node dist/index.js --site https://try.discourse.org`
- With writes (example): `node dist/index.js --site https://try.discourse.org --user_api_key $KEY --allow_writes --read_only=false`
