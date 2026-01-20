# AGENTS.md — Discourse MCP

MCP server exposing Discourse forum capabilities as tools/resources for AI agents.
Entry: `src/index.ts` → `dist/index.js` (binary: `discourse-mcp`). Node >= 24.

## SDLC Commands

```bash
pnpm build       # Compile TypeScript to dist/
pnpm typecheck   # Type-check only (no emit)
pnpm lint        # Run ESLint on src/
pnpm test        # Run tests (requires build first)
pnpm clean       # Remove dist/
```

## Source Map

| Area | Files |
|------|-------|
| Entry/CLI | `src/index.ts` |
| HTTP client | `src/http/client.ts` |
| Tool registry | `src/tools/registry.ts` |
| Resource registry | `src/resources/registry.ts` |
| Built-in tools | `src/tools/builtin/*` |
| Remote tools | `src/tools/remote/tool_exec_api.ts` |
| Utilities | `src/util/*.ts` (logger, redact, json_response) |

## Key Patterns

**Tool Implementation**
- Tools live in `src/tools/builtin/` as individual files
- Each tool exports a registration function called by `src/tools/registry.ts`
- All tools return strict JSON (no Markdown) with `isError: true` on failure
- Write tools require `--allow_writes` flag and matching `auth_pairs` entry

**Resources**
- URI-addressable read-only data (categories, tags, groups, channels, drafts)
- Registered in `src/resources/registry.ts`

**HTTP Layer**
- Client in `src/http/client.ts` handles auth, retries (429/5xx), caching
- User-Agent: `Discourse-MCP/0.x`
- Write tools enforce ~1 req/sec rate limit

**Configuration**
- CLI flags validated via Zod in `src/index.ts`
- Auth via `--auth_pairs` JSON (API keys or User API keys)
- `--site <url>` tethers to single site, hides `discourse_select_site` tool

**Testing**
- Tests in `src/test/` use Node's built-in test runner
- Build before running tests: `pnpm build && pnpm test`

## Adding a New Tool

1. Create `src/tools/builtin/<name>.ts`
2. Export a `RegisterFn` function
3. Import and call it in `src/tools/registry.ts`

**Minimal template:**
```typescript
import { z } from "zod";
import type { RegisterFn } from "../types.js";
import { jsonResponse, jsonError } from "../../util/json_response.js";

export const registerMyTool: RegisterFn = (server, ctx, opts) => {
  if (!opts.allowWrites) return; // omit for read-only tools

  server.registerTool(
    "discourse_my_tool",
    {
      title: "My Tool",
      description: "Does X. Returns JSON with Y.",
      inputSchema: z.object({ id: z.number() }).shape,
    },
    async (args) => {
      const { client } = ctx.siteState.ensureSelectedSite();
      try {
        const data = await client.get(`/endpoint.json`);
        return jsonResponse(data);
      } catch (e: any) {
        return jsonError(`Failed: ${e?.message}`);
      }
    }
  );
};
```

**Key helpers:**
- `jsonResponse(data)` — success response
- `jsonError(msg)` — error with `isError: true`
- `paginatedResponse(name, items, meta)` — for lists
- `rateLimit(key)` — throttle writes (call before mutations)
- `ctx.siteState.ensureSelectedSite()` — get `{ base, client }`
