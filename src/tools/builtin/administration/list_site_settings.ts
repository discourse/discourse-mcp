import { z } from "zod";
import { defineTool } from "../../definition.js";
import { requireAdminAccess } from "../../../util/access.js";
import { jsonResponse } from "../../../util/json_response.js";
import { bounded, queryString, readAnnotations, upstreamError } from "../common/helpers.js";

const schema = z.object({
  categories: z.array(z.string().min(1)).max(50).optional(),
  plugin: z.string().min(1).optional(),
  names: z.array(z.string().regex(/^[a-z0-9_]+$/)).max(100).optional(),
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(500).optional(),
});

export const listSiteSettingsTool = defineTool({
  name: "discourse_list_site_settings",
  title: "List Site Settings",
  description: "List admin-visible Discourse site settings, optionally filtered by upstream category, plugin, or exact setting names. Returns bounded metadata and values; hidden settings remain controlled by Discourse.",
  schema,
  availability: "always",
  toolsets: ["administration"],
  annotations: readAnnotations(),
  handler: async ({ categories, plugin, names, offset = 0, limit = 100 }, _extra, ctx) => {
    try {
      const accessError = requireAdminAccess(ctx.siteState);
      if (accessError) return accessError;
      const { client } = ctx.siteState.ensureSelectedSite();
      const data = await client.get(`/admin/site_settings.json${queryString({ categories, plugin, names })}`) as any;
      const source = Array.isArray(data?.site_settings) ? data.site_settings : [];
      const rows = source.slice(offset, offset + limit).map((setting: any) => ({
        setting: setting?.setting ?? setting?.name ?? null,
        value: setting?.value ?? null,
        default: setting?.default ?? null,
        type: setting?.type ?? null,
        category: setting?.category ?? null,
        subcategory: setting?.subcategory ?? null,
        description: bounded(setting?.description, ctx.maxReadLength),
        plugin: setting?.plugin ?? null,
        valid_values: Array.isArray(setting?.valid_values) ? setting.valid_values.slice(0, 200) : null,
      }));
      return jsonResponse({ site_settings: rows, meta: { offset, limit, returned: rows.length, total: source.length, has_more: offset + rows.length < source.length, next_offset: offset + rows.length < source.length ? offset + rows.length : null } });
    } catch (error) {
      return upstreamError("Failed to list site settings", error);
    }
  },
});
