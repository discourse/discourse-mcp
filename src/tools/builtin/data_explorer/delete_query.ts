import { z } from "zod";
import { defineTool } from "../../definition.js";
import {
  jsonResponse,
  jsonError,
  isZodError,
  zodError,
  rateLimit,
} from "../../../util/json_response.js";
import { requireAdminAccess } from "../../../util/access.js";

const schema = z.object({
  id: z.number().int().positive().describe("Query ID to delete"),
});

export const deleteQueryTool = defineTool({
  name: "discourse_delete_query",
  title: "Delete Data Explorer Query",
  description: "Soft-delete a Data Explorer query. The query can be restored by an admin. Requires admin API key and write access.",
  schema,
  availability: "writes_enabled",
  toolsets: ["data_explorer"],
  handler: async (input: unknown, _extra: unknown, ctx, _opts) => {
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
  },
});
