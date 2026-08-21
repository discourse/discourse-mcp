import { z } from "zod";
import { defineTool } from "../../definition.js";
import { requireAdminAccess } from "../../../util/access.js";
import { jsonResponse } from "../../../util/json_response.js";
import { queryString, readAnnotations, upstreamError } from "../common/helpers.js";
import { isSettingOverridden, projectSiteSetting } from "../site_settings/common.js";

const schema = z.object({
  categories: z.array(z.string().min(1).max(200)).max(50).optional(),
  plugin: z.string().max(200).optional(),
  names: z.array(z.string().regex(/^[a-z0-9_]+$/).max(200)).max(100).optional(),
  overridden_only: z.boolean().optional(),
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(500).optional(),
}).strict();

export const listSiteSettingsTool = defineTool({
  name: "discourse_list_site_settings",
  title: "List Site Settings",
  description: "List admin-visible Discourse site settings with bounded metadata, optionally returning only settings whose current value differs from the default. Secret and credential-like values are always masked.",
  schema,
  availability: "always",
  toolsets: ["administration", "site_settings"],
  annotations: readAnnotations(),
  handler: async ({ categories, plugin, names, overridden_only = false, offset = 0, limit = 100 }, _extra, ctx) => {
    try {
      const accessError = requireAdminAccess(ctx.siteState);
      if (accessError) return accessError;
      const { client } = ctx.siteState.ensureSelectedSite();
      const normalizedCategories = categories?.map((value) => value.trim()).filter(Boolean);
      const normalizedNames = names?.filter(Boolean);
      const normalizedPlugin = plugin?.trim() || undefined;
      const data = await client.get(`/admin/site_settings.json${queryString({ categories: normalizedCategories?.length ? normalizedCategories : undefined, plugin: normalizedPlugin, names: normalizedNames?.length ? normalizedNames : undefined })}`) as any;
      const fetched = Array.isArray(data?.site_settings) ? data.site_settings : [];
      const requested = normalizedNames?.length ? new Set(normalizedNames) : null;
      const byName = new Map<string, any>();
      for (const setting of fetched) {
        const name = String(setting?.setting ?? setting?.name ?? "");
        if (!requested || requested.has(name)) byName.set(name, setting);
      }
      const allVisible = [...byName.values()];
      const source = overridden_only ? allVisible.filter(isSettingOverridden) : allVisible;
      const rows = source.slice(offset, offset + limit).map((setting: any) => projectSiteSetting(setting, ctx.maxReadLength));
      const hasMore = offset + rows.length < source.length;
      return jsonResponse({ site_settings: rows, meta: { offset, limit, returned: rows.length, total: source.length, total_before_local_filter: allVisible.length, overridden_only, has_more: hasMore, next_offset: hasMore ? offset + rows.length : null } });
    } catch (error) {
      return upstreamError("Failed to list site settings", error);
    }
  },
});
