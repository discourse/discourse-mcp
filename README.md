## Discourse MCP

A Model Context Protocol (MCP) stdio server that exposes Discourse forum capabilities as tools for AI agents.

- **Entry point**: `src/index.ts` → compiled to `dist/index.js` (binary name: `discourse-mcp`)
- **SDK**: `@modelcontextprotocol/sdk`
- **Node**: >= 18

### TL;DR: Configure and run

- **Install and build**
```bash
pnpm install
pnpm build
```

- **Run locally (read‑only, recommended to start):**
```bash
node dist/index.js
```
Then, in your MCP client, call the `discourse_select_site` tool with `{ "site": "https://try.discourse.org" }` to choose a site.

- **Enable writes (opt‑in, safe‑guarded):**
```bash
node dist/index.js \
  --site https://try.discourse.org \
  --allow_writes --read_only=false \
  --user_api_key $DISCOURSE_USER_API_KEY
```

- **Use in an MCP client (example: Claude Desktop) — local build:**
```json
{
  "mcpServers": {
    "discourse": {
      "command": "node",
      "args": ["/absolute/path/to/dist/index.js"],
      "env": {}
    }
  }
}
```

- **Use in an MCP client — if installed globally** (after publishing or `npm -g`):
```json
{
  "mcpServers": {
    "discourse": {
      "command": "discourse-mcp",
      "args": []
    }
  }
}
```

## Configuration

The server registers tools under the MCP server name `@discourse/mcp`. You select the target Discourse site at runtime using the `discourse_select_site` tool, which validates the site via `/about.json`.

- **Auth modes**
  - **None** (default): read‑only public data.
  - **`--api_key <key>`** (+ optional `--api_username <name>`): Default API key used when no per‑site override matches.
  - **`--user_api_key <key>`**: Default User API key used when no per‑site override matches.
  - **`--auth_pairs '[{"site":"https://example.com","api_key":"...","api_username":"system"}]'`**: Optional per‑site auth overrides; matched by origin. You can include multiple entries. When present for a selected site, overrides the default auth.
  - Provide only one of `--api_key` or `--user_api_key` (mutually exclusive).

- **Write safety**
  - Writes are disabled by default.
  - The tool `discourse.create_post` is only registered when all are true:
    - `--allow_writes` AND not `--read_only` AND some auth is configured (either default flags or a matching `auth_pairs` entry).
  - A ~1 req/sec rate limit is enforced for `create_post`.

- **Flags & defaults**
  - `--read_only` (default: true)
  - `--allow_writes` (default: false)
  - `--timeout_ms <number>` (default: 15000)
  - `--concurrency <number>` (default: 4)
  - `--log_level <silent|error|info|debug>` (default: info)
  - `--tools_mode <auto|discourse_api_only|tool_exec_api>` (default: auto)
  - `--cache_dir <path>` (reserved)
  - `--profile <path.json>` (see below)

- **Profile file** (keep secrets off the command line)
```json
{
  "user_api_key": "<redacted>",
  "auth_pairs": [
    { "site": "https://try.discourse.org", "user_api_key": "<redacted>" }
  ],
  "read_only": false,
  "allow_writes": true,
  "log_level": "info",
  "tools_mode": "auto"
}
```
Run with:
```bash
node dist/index.js --profile /absolute/path/to/profile.json
```
Flags still override values from the profile.

- **Remote Tool Execution API (optional)**
  - With `tools_mode=auto` (default) or `tool_exec_api`, the server discovers remote tools via GET `/ai/tools` after you select a site and registers them dynamically. Set `--tools_mode=discourse_api_only` to disable remote tool discovery.

- **Networking & resilience**
  - Retries on 429/5xx with backoff (3 attempts).
  - Lightweight in‑memory GET cache for selected endpoints.

- **Privacy**
  - Secrets are redacted in logs. Errors are returned as human‑readable messages to MCP clients.

## Tools

Built‑in tools (always present unless noted):

- `discourse_search`
  - Input: `{ query: string; with_private?: boolean; max_results?: number (1–50, default 10) }`
  - Output: text summary plus a compact footer like:
    ```json
    { "results": [{ "id": 123, "url": "https://…", "title": "…" }] }
    ```
- `discourse_read_topic`
  - Input: `{ topic_id: number; post_limit?: number (1–20, default 5) }`
- `discourse_read_post`
  - Input: `{ post_id: number }`
- `discourse_list_categories`
  - Input: `{}`
- `discourse_list_tags`
  - Input: `{}`
- `discourse_get_user`
  - Input: `{ username: string }`
- `discourse_create_post` (only when writes enabled; see Write safety)
  - Input: `{ topic_id: number; raw: string (≤ 30k chars) }`

Notes:
- Outputs are human‑readable first. Where applicable, a compact JSON is embedded in fenced code blocks to ease structured extraction by agents.

## Development

- **Requirements**: Node >= 18, `pnpm`.

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
  - Built‑in tools: `src/tools/builtin/*`
  - Remote tools: `src/tools/remote/tool_exec_api.ts`
  - Logging/redaction: `src/util/logger.ts`, `src/util/redact.ts`

- **Testing notes**
  - Tests run with Node’s test runner against compiled artifacts (`dist/test/**/*.js`). Ensure `pnpm build` before `pnpm test` if invoking scripts individually.

- **Publishing (optional)**
  - The package exposes a `bin` named `discourse-mcp`. After publishing or global install, MCP clients can invoke the binary directly without `node dist/index.js`.

- **Conventions**
  - Focus on text‑oriented outputs; keep embedded JSON concise.
  - Be careful with write operations; keep them opt‑in and rate‑limited.

See `AGENTS.md` for additional guidance on using this server from agent frameworks.

## Examples

- Read‑only session against `try.discourse.org`:
```bash
node dist/index.js --log_level debug
# In client: call discourse_select_site with {"site":"https://try.discourse.org"}
```

- Create a post (writes enabled):
```bash
node dist/index.js --allow_writes --read_only=false --auth_pairs '[{"site":"https://try.discourse.org","api_key":"'$DISCOURSE_API_KEY'","api_username":"system"}]'
```

## FAQ

- **Why is `create_post` missing?** You’re in read‑only mode. Enable writes as described above.
- **Can I disable remote tool discovery?** Yes, run with `--tools_mode=discourse_api_only`.
- **Time outs or rate limits?** Increase `--timeout_ms`, and note built‑in retry/backoff on 429/5xx.
