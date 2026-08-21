import { defineTool } from "../../definition.js";
import { jsonResponse, isZodError, zodError } from "../../../util/json_response.js";
import { readAnnotations } from "../common/helpers.js";
import { listThemesSchema } from "./schemas.js";
import { requireThemeRead, themeReadError } from "./common.js";
import { slimTheme } from "./projections.js";

export const listThemesTool = defineTool({
  name: "discourse_list_themes",
  title: "List Themes",
  description: "List admin-visible Discourse themes and components. This opt-in admin read returns bounded summaries and local pagination; it does not expose theme source code.",
  schema: listThemesSchema,
  availability: "always",
  toolsets: ["themes"],
  annotations: readAnnotations(),
  handler: async (input, _extra, ctx) => {
    try {
      const { kind, query, include_system, limit, offset } = listThemesSchema.parse(input);
      const accessError = requireThemeRead(ctx.siteState);
      if (accessError) return accessError;
      const { client } = ctx.siteState.ensureSelectedSite();
      const response = await client.get("/admin/themes.json") as any;
      const upstream = Array.isArray(response?.themes) ? response.themes : [];
      const needle = query?.toLocaleLowerCase();
      const visible: Array<Record<string, unknown>> = upstream.map(slimTheme).filter((theme: Record<string, unknown>) => {
        if (kind === "theme" && theme.component !== false) return false;
        if (kind === "component" && theme.component !== true) return false;
        if (!include_system && theme.system === true) return false;
        if (needle && !String(theme.name ?? "").toLocaleLowerCase().includes(needle)) return false;
        return true;
      });
      const themes = visible.slice(offset, offset + limit);
      return jsonResponse({ themes, meta: { total_visible: visible.length, offset, limit, returned: themes.length, has_more: offset + themes.length < visible.length, pagination: "local" } });
    } catch (error) {
      if (isZodError(error)) return zodError(error);
      return themeReadError("Failed to list themes", error);
    }
  },
});
