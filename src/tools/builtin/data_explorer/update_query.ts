import { z } from "zod";
import type { RegisterFn } from "../../types.js";
import {
  jsonResponse,
  jsonError,
  isZodError,
  zodError,
  rateLimit,
  transformQueryDetail,
} from "../../../util/json_response.js";
import { requireAdminAccess } from "../../../util/access.js";

export const registerUpdateQuery: RegisterFn = (server, ctx, opts) => {
  if (!opts.allowWrites) return;

  const schema = z.object({
    id: z.number().int().positive().describe("Query ID to update"),
    name: z.string().min(1).max(255).optional().describe("New query name"),
    sql: z
      .string()
      .min(1)
      .optional()
      .describe("New SQL query"),
    description: z.string().optional().describe("New query description"),
    group_ids: z
      .array(z.number().int())
      .optional()
      .describe("New group IDs allowed to run this query"),
  });

  server.registerTool(
    "discourse_update_query",
    {
      title: "Update Data Explorer Query",
      description:
        "Update an existing Data Explorer query. Only provided fields are updated. Requires admin API key and write access.",
      inputSchema: schema.shape,
    },
    async (input: unknown, _extra: unknown) => {
      try {
        const { id, name, sql, description, group_ids } = schema.parse(input);

        const accessError = requireAdminAccess(ctx.siteState);
        if (accessError) return accessError;

        await rateLimit("query");

        const { client } = ctx.siteState.ensureSelectedSite();

        const queryUpdate: Record<string, unknown> = {};
        if (name !== undefined) queryUpdate.name = name;
        if (sql !== undefined) queryUpdate.sql = sql;
        if (description !== undefined) queryUpdate.description = description;
        if (group_ids !== undefined) queryUpdate.group_ids = group_ids;

        if (Object.keys(queryUpdate).length === 0) {
          return jsonError("No fields to update");
        }

        const payload = { query: queryUpdate };

        const data = (await client.put(
          `/admin/plugins/explorer/queries/${id}.json`,
          payload
        )) as any;

        const query = data?.query || data;
        return jsonResponse(transformQueryDetail(query));
      } catch (e: unknown) {
        if (isZodError(e)) return zodError(e);
        const err = e as any;
        return jsonError(`Failed to update query: ${err?.message || String(e)}`);
      }
    }
  );
};
