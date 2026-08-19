import { z } from "zod";
import { defineTool } from "../../definition.js";
import {
  jsonResponse,
  jsonError,
  isZodError,
  zodError,
  transformQueryDetail,
} from "../../../util/json_response.js";
import { requireAdminAccess } from "../../../util/access.js";

import { readAnnotations } from "../common/helpers.js";

const schema = z.object({
  id: z.number().int().positive().describe("Query ID"),
});

export const getQueryTool = defineTool({
  name: "discourse_get_query",
  title: "Get Data Explorer Query",
  description: "Get full details of a Data Explorer query including SQL and parameters. Requires admin API key.",
  schema,
  availability: "always",
  toolsets: ["data_explorer"],
  annotations: readAnnotations(),
  handler: async (input: unknown, _extra: unknown, ctx, _opts) => {
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
  },
});
