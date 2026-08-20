import { defineTool } from "../../definition.js";
import { jsonResponse, isZodError, zodError } from "../../../util/json_response.js";
import { readAnnotations } from "../common/helpers.js";
import { getThemeSchema } from "./schemas.js";
import { requireThemeRead, themeReadError } from "./common.js";
import { detailedTheme } from "./projections.js";

export const getThemeTool = defineTool({
  name: "discourse_get_theme",
  title: "Get Theme",
  description: "Inspect one local, ZIP-imported, or Git-backed Discourse theme/component as an administrator. Source values are bounded, opt-in, and may be unavailable for remote records; private key material is never returned.",
  schema: getThemeSchema,
  availability: "always",
  toolsets: ["themes"],
  annotations: readAnnotations(),
  handler: async (input, _extra, ctx) => {
    try {
      const { theme_id, include_field_values } = getThemeSchema.parse(input);
      const accessError = requireThemeRead(ctx.siteState);
      if (accessError) return accessError;
      const { client } = ctx.siteState.ensureSelectedSite();
      return jsonResponse(detailedTheme(await client.get(`/admin/themes/${theme_id}.json`), include_field_values));
    } catch (error) {
      if (isZodError(error)) return zodError(error);
      return themeReadError("Failed to get theme", error);
    }
  },
});
