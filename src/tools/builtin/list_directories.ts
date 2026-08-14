import { z } from "zod";
import { HttpError } from "../../http/client.js";
import {
  fetchAllCategories,
  fetchAllGroups,
  fetchAllTagGroups,
} from "../../site/directories.js";
import {
  structuredJsonError,
  structuredJsonResponse,
} from "../../util/json_response.js";
import type { RegisterFn } from "../types.js";

const emptyInputSchema = z.object({});
const directoryEntrySchema = z.object({
  id: z.number().int(),
  name: z.string(),
});
const categoryEntrySchema = z.object({
  id: z.number().int(),
  name: z.string(),
  parent_category_id: z.number().int().nullable(),
});
const metaSchema = z.object({
  total: z.number().int().nonnegative(),
});

const readAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

function toDirectoryEntries(rawItems: any[]): Array<{ id: number; name: string }> {
  return rawItems.flatMap((item) =>
    typeof item?.id === "number" && Number.isInteger(item.id) && typeof item?.name === "string"
      ? [{ id: item.id, name: item.name }]
      : []
  );
}

function toCategoryEntries(
  rawItems: any[]
): Array<{ id: number; name: string; parent_category_id: number | null }> {
  return rawItems.flatMap((item) =>
    typeof item?.id === "number" && Number.isInteger(item.id) && typeof item?.name === "string"
      ? [{
          id: item.id,
          name: item.name,
          parent_category_id: Number.isInteger(item.parent_category_id)
            ? (item.parent_category_id as number)
            : null,
        }]
      : []
  );
}

export const registerListCategories: RegisterFn = (server, ctx) => {
  const outputSchema = z.object({
    categories: z.array(categoryEntrySchema),
    meta: metaSchema,
  });

  server.registerTool(
    "discourse_list_categories",
    {
      title: "List Categories",
      description: "List every category visible to the configured Discourse API user. Returns numeric IDs, names, and parent_category_id (null for top-level) so the category hierarchy can be reconstructed.",
      inputSchema: emptyInputSchema.shape,
      outputSchema: outputSchema.shape,
      annotations: readAnnotations,
    },
    async (_args, _extra) => {
      try {
        const { client } = ctx.siteState.ensureSelectedSite();
        const categories = toCategoryEntries(await fetchAllCategories(client));
        return structuredJsonResponse({ categories, meta: { total: categories.length } });
      } catch (e: any) {
        return structuredJsonError(`Failed to list categories: ${e?.message || String(e)}`);
      }
    }
  );
};

export const registerListGroups: RegisterFn = (server, ctx) => {
  const outputSchema = z.object({
    groups: z.array(directoryEntrySchema),
    meta: metaSchema,
  });

  server.registerTool(
    "discourse_list_groups",
    {
      title: "List Groups",
      description: "List every group visible to the configured Discourse API user. Returns only numeric IDs and names.",
      inputSchema: emptyInputSchema.shape,
      outputSchema: outputSchema.shape,
      annotations: readAnnotations,
    },
    async (_args, _extra) => {
      try {
        const { client } = ctx.siteState.ensureSelectedSite();
        const groups = toDirectoryEntries(await fetchAllGroups(client));
        return structuredJsonResponse({ groups, meta: { total: groups.length } });
      } catch (e: any) {
        return structuredJsonError(`Failed to list groups: ${e?.message || String(e)}`);
      }
    }
  );
};

export const registerListTagGroups: RegisterFn = (server, ctx) => {
  const outputSchema = z.object({
    tag_groups: z.array(directoryEntrySchema),
    meta: metaSchema,
  });

  server.registerTool(
    "discourse_list_tag_groups",
    {
      title: "List Tag Groups",
      description: "List every tag group. Discourse requires the configured API user to be staff.",
      inputSchema: emptyInputSchema.shape,
      outputSchema: outputSchema.shape,
      annotations: readAnnotations,
    },
    async (_args, _extra) => {
      try {
        const { client } = ctx.siteState.ensureSelectedSite();
        const tag_groups = toDirectoryEntries(await fetchAllTagGroups(client));
        return structuredJsonResponse({ tag_groups, meta: { total: tag_groups.length } });
      } catch (e: any) {
        if (e instanceof HttpError && [401, 403, 404].includes(e.status)) {
          return structuredJsonError(
            "Listing tag groups requires an authenticated Discourse staff account.",
            { code: "staff_access_required", status: e.status }
          );
        }
        return structuredJsonError(`Failed to list tag groups: ${e?.message || String(e)}`);
      }
    }
  );
};
