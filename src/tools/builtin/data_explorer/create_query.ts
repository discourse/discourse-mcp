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

export const registerCreateQuery: RegisterFn = (server, ctx, opts) => {
  if (!opts.allowAdminTools || !opts.allowWrites) return;

  const schema = z.object({
    name: z
      .string()
      .min(1)
      .max(255)
      .describe("Query name"),
    sql: z
      .string()
      .min(1)
      .describe("SQL query. Declare parameters in comments: -- [params]\\n-- int :user_id"),
    description: z.string().optional().describe("Query description"),
    group_ids: z
      .array(z.number().int())
      .optional()
      .describe("Group IDs allowed to run this query (empty = admin only)"),
  });

  server.registerTool(
    "discourse_create_query",
    {
      title: "Create Data Explorer Query",
      description:
        "Create a new saved Data Explorer query. Requires admin API key and write access.",
      inputSchema: schema.shape,
    },
    async (input: unknown, _extra: unknown) => {
      try {
        const { name, sql, description, group_ids } = schema.parse(input);

        const accessError = requireAdminAccess(ctx.siteState);
        if (accessError) return accessError;

        await rateLimit("query");

        const { client } = ctx.siteState.ensureSelectedSite();

        const payload: Record<string, unknown> = {
          query: {
            name,
            sql,
            description: description || "",
            group_ids: group_ids || [],
          },
        };

        const data = (await client.post(
          "/admin/plugins/explorer/queries.json",
          payload
        )) as any;

        const query = data?.query || data;
        return jsonResponse(transformQueryDetail(query));
      } catch (e: unknown) {
        if (isZodError(e)) return zodError(e);
        const err = e as any;
        return jsonError(`Failed to create query: ${err?.message || String(e)}`);
      }
    }
  );
};
