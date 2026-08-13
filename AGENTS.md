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
| Tool definitions/catalog | `src/tools/definition.ts`, `src/tools/builtin/catalog.ts` |
| Built-in toolsets | `src/tools/toolsets.ts` |
| Resource registry | `src/resources/registry.ts` |
| Built-in tools | `src/tools/builtin/*` |
| Remote tools | `src/tools/remote/tool_exec_api.ts` |
| Utilities | `src/util/*.ts` (logger, redact, json_response) |

## Key Patterns

**Tool Implementation**
- Tools live in `src/tools/builtin/` as typed `defineTool({...})` definitions
- `src/tools/builtin/catalog.ts` is the ordered built-in collection; `src/tools/registry.ts` registers it through the shared registrar
- Every definition declares two independent registration dimensions:
  - `availability` is one mutually exclusive configuration gate: `always`, `writes_enabled`, or `site_selection`
  - `toolsets` is a non-empty list of operator-facing domains; selected domains form a union while preserving catalog order
- Availability is not domain metadata, and toolsets do not replace write, authentication, or admin checks
- All tools return strict JSON (no Markdown) with `isError: true` on failure
- Write tools use `writes_enabled` and retain a call-time access check; they require `--allow_writes` and matching `auth_pairs`

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

A definition has two separate exposure concepts:

| Field | Cardinality | Meaning |
|---|---|---|
| `availability` | Exactly one | Registration-time configuration gate. `always` is ungated, `writes_enabled` requires effective write mode, and `site_selection` is the untethered bootstrap tool class hidden by `--site`. |
| `toolsets` | One or more | Operator-selectable domain membership. Multiple memberships are ORed; they do not grant write or admin access. |

Call-time authorization remains in the handler because it can depend on the currently selected site.

1. Create `src/tools/builtin/<name>.ts` and export a definition using `defineTool()`.
2. Choose an explicit availability: `always`, `writes_enabled`, or `site_selection`.
3. Assign one or more typed operator domains in `toolsets` (see `src/tools/toolsets.ts`).
4. Retain the appropriate call-time access check (`requireWriteAccess()` or `requireAdminAccess()`).
5. Add the definition to `builtinTools` in `src/tools/builtin/catalog.ts`, or to an ordered domain sub-collection included there.
6. Add handler behavior tests in `src/test/` and update toolset contract tests when membership changes.
7. Run `pnpm typecheck`, `pnpm build`, `pnpm test`, and `pnpm lint`.

A normal built-in does not call `server.registerTool()` and does not require an edit to `src/tools/registry.ts`.

**Read tool example:**
```typescript
import { z } from "zod";
import { defineTool } from "../definition.js";
import { jsonResponse, jsonError } from "../../util/json_response.js";

const schema = z.object({ id: z.number().int().positive() });

export const getThingTool = defineTool({
  name: "discourse_get_thing",
  title: "Get Thing",
  description: "Get a thing. Returns JSON with its details.",
  schema,
  availability: "always",
  toolsets: ["topics"],
  handler: async ({ id }, _extra, ctx, _opts) => {
    const { client } = ctx.siteState.ensureSelectedSite();
    try {
      return jsonResponse(await client.get(`/things/${id}.json`));
    } catch (e: any) {
      return jsonError(`Failed to get thing: ${e?.message || String(e)}`);
    }
  },
});
```

**Write tool example:**
```typescript
import { z } from "zod";
import { defineTool } from "../definition.js";
import { requireWriteAccess } from "../../util/access.js";
import { jsonResponse, jsonError, rateLimit } from "../../util/json_response.js";

const schema = z.object({ name: z.string().min(1) });

export const createThingTool = defineTool({
  name: "discourse_create_thing",
  title: "Create Thing",
  description: "Create a thing. Returns JSON with its id and name.",
  schema,
  availability: "writes_enabled",
  toolsets: ["topics"],
  handler: async (input, _extra, ctx, opts) => {
    try {
      const { name } = schema.parse(input);
      const accessError = requireWriteAccess(ctx.siteState, opts.allowWrites);
      if (accessError) return accessError;
      await rateLimit("thing");
      const { client } = ctx.siteState.ensureSelectedSite();
      return jsonResponse(await client.post("/things.json", { name }));
    } catch (e: any) {
      return jsonError(`Failed to create thing: ${e?.message || String(e)}`);
    }
  },
});
```

**Key helpers:**
- `jsonResponse(data)` — success response
- `jsonError(msg)` — error with `isError: true`
- `paginatedResponse(name, items, meta)` — for lists
- `rateLimit(key)` — throttle writes (call before mutations)
- `ctx.siteState.ensureSelectedSite()` — get `{ base, client }`
