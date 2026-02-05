import { z } from "zod";
import type { RegisterFn } from "../../types.js";
import {
  jsonResponse,
  jsonError,
  isZodError,
  zodError,
  type QueryRunResult,
} from "../../../util/json_response.js";
import { requireAdminAccess } from "../../../util/access.js";

export const registerRunQuery: RegisterFn = (server, ctx, opts) => {
  if (!opts.allowAdminTools) return;
  const schema = z.object({
    id: z.number().int().describe("Query ID to run"),
    params: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Query parameters as key-value pairs"),
    limit: z
      .union([z.number().int().positive(), z.literal("ALL")])
      .optional()
      .describe(
        "Maximum number of rows to return (default: query default, use 'ALL' for unlimited)",
      ),
    explain: z
      .boolean()
      .optional()
      .describe("Include query execution plan in response"),
  });

  server.registerTool(
    "discourse_run_query",
    {
      title: "Run Data Explorer Query",
      description:
        "Execute a Data Explorer query with parameters. Returns columns, rows, result_count, duration_ms. Queries run in read-only transactions with 10-second timeout. Requires admin API key.",
      inputSchema: schema.shape,
    },
    async (input: unknown, _extra: unknown) => {
      try {
        const { id, params, limit, explain } = schema.parse(input);

        const accessError = requireAdminAccess(ctx.siteState);
        if (accessError) return accessError;

        const { client } = ctx.siteState.ensureSelectedSite();

        const payload: Record<string, unknown> = {};
        if (params && Object.keys(params).length > 0) {
          payload.params = JSON.stringify(params);
        }
        if (limit !== undefined) {
          payload.limit = limit;
        }
        if (explain) {
          payload.explain = true;
        }

        const data = (await client.post(
          `/admin/plugins/explorer/queries/${id}/run.json`,
          payload,
        )) as any;

        const result: QueryRunResult = {
          columns: Array.isArray(data?.columns) ? data.columns : [],
          rows: Array.isArray(data?.rows) ? data.rows : [],
          result_count: data?.result_count ?? data?.rows?.length ?? 0,
          duration_ms: data?.duration ?? 0,
        };

        if (data?.explain) {
          result.explain = data.explain;
        }

        if (data?.relations && Object.keys(data.relations).length > 0) {
          result.relations = data.relations;
        }

        return jsonResponse(result);
      } catch (e: unknown) {
        if (isZodError(e)) return zodError(e);
        const err = e as any;
        return jsonError(`Failed to run query: ${err?.message || String(e)}`);
      }
    },
  );
};
