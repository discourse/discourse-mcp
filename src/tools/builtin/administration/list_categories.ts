import { z } from "zod";
import { defineTool } from "../../definition.js";
import { fetchAllCategories } from "../../../site/directories.js";
import {
  isZodError,
  jsonError,
  structuredJsonResponse,
  zodError,
} from "../../../util/json_response.js";
import { readAnnotations, upstreamError } from "../common/helpers.js";
import { categoryDirectoryOutputSchema } from "../common/directory_schemas.js";

const schema = z.object({
  term: z.string().trim().min(1).max(250).optional(),
  max_pages: z.number().int().min(1).max(40).optional(),
  max_requests: z.number().int().min(1).max(40).optional(),
  max_results: z.number().int().min(1).max(1000).optional(),
  deadline_ms: z.number().int().min(100).max(120_000).optional(),
}).strict();

export const listCategoriesTool = defineTool({
  name: "discourse_list_categories",
  title: "List Categories",
  description: "Exhaustively list categories visible to the selected identity through bounded pagination. Returns stable IDs, slugs, hierarchy (parent_category_id; pid is a legacy alias), access flags, counts, structured completion metadata, and JSON text fallback. Opt in with the administration toolset.",
  schema,
  outputSchema: categoryDirectoryOutputSchema,
  availability: "always",
  toolsets: ["administration"],
  annotations: readAnnotations(),
  handler: async (input, extra, ctx) => {
    try {
      const values = schema.parse(input);
      const { client } = ctx.siteState.ensureSelectedSite();
      const result = await fetchAllCategories(client, {
        ...values,
        authenticated: ctx.siteState.getAuthType() !== "none",
        signal: extra.signal,
      });
      if (result.meta.truncated_reason === "upstream_error" && result.meta.error?.startsWith("Malformed")) {
        return jsonError("Failed to list categories: malformed upstream category record", {
          code: "malformed_upstream_response",
        });
      }
      const normalized = categoryDirectoryOutputSchema.parse(result);
      return structuredJsonResponse(normalized);
    } catch (error) {
      if (isZodError(error)) return zodError(error);
      return upstreamError("Failed to list categories", error);
    }
  },
});
