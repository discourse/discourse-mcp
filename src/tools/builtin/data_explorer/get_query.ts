import { z } from "zod";
import type { RegisterFn } from "../../types.js";
import {
  jsonResponse,
  jsonError,
  isZodError,
  zodError,
  transformQueryDetail,
} from "../../../util/json_response.js";
import { requireAdminAccess } from "../../../util/access.js";

export const registerGetQuery: RegisterFn = (server, ctx, _opts) => {
  const schema = z.object({
    id: z.number().int().positive().describe("Query ID"),
  });

  server.registerTool(
    "discourse_get_query",
    {
      title: "Get Data Explorer Query",
      description:
        "Get full details of a Data Explorer query including SQL and parameters. Requires admin API key.",
      inputSchema: schema.shape,
    },
    async (input: unknown, _extra: unknown) => {
      try {
        const { id } = schema.parse(input);

        const accessError = requireAdminAccess(ctx.siteState);
        if (accessError) return accessError;

        const { client } = ctx.siteState.ensureSelectedSite();

        const data = (await client.get(
          `/admin/plugins/explorer/queries/${id}.json`
        )) as any;

        const query = data?.query || data;
        return jsonResponse(transformQueryDetail(query));
      } catch (e: unknown) {
        if (isZodError(e)) return zodError(e);
        const err = e as any;
        return jsonError(`Failed to get query: ${err?.message || String(e)}`);
      }
    }
  );
};
