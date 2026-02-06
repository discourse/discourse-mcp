import { z } from "zod";
import type { RegisterFn } from "../../types.js";
import {
  jsonResponse,
  jsonError,
  isZodError,
  zodError,
  rateLimit,
} from "../../../util/json_response.js";
import { requireAdminAccess } from "../../../util/access.js";

export const registerDeleteQuery: RegisterFn = (server, ctx, opts) => {
  if (!opts.allowAdminTools || !opts.allowWrites) return;

  const schema = z.object({
    id: z.number().int().positive().describe("Query ID to delete"),
  });

  server.registerTool(
    "discourse_delete_query",
    {
      title: "Delete Data Explorer Query",
      description:
        "Soft-delete a Data Explorer query. The query can be restored by an admin. Requires admin API key and write access.",
      inputSchema: schema.shape,
    },
    async (input: unknown, _extra: unknown) => {
      try {
        const { id } = schema.parse(input);

        const accessError = requireAdminAccess(ctx.siteState);
        if (accessError) return accessError;

        await rateLimit("query");

        const { client } = ctx.siteState.ensureSelectedSite();

        await client.delete(`/admin/plugins/explorer/queries/${id}.json`);

        return jsonResponse({ deleted: true, id });
      } catch (e: unknown) {
        if (isZodError(e)) return zodError(e);
        const err = e as any;
        return jsonError(`Failed to delete query: ${err?.message || String(e)}`);
      }
    }
  );
};
