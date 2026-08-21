import { z } from "zod";
import { defineTool } from "../../definition.js";
import { jsonResponse, withRateLimit } from "../../../util/json_response.js";
import { pluginError, queryString, readAnnotations } from "../common/helpers.js";
import { requireAnalyticsAccess } from "./common.js";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
const schema = z.object({ start_date: isoDate.optional(), end_date: isoDate.optional(), category_ids: z.array(z.number().int().positive()).max(100).optional() });

export const getSupportDashboardTool = defineTool({
  name: "discourse_get_support_dashboard",
  title: "Get Solved Support Dashboard",
  description: "Get the staff Solved support dashboard. Requires Discourse Solved. 'Unanswered' means unsolved with no qualifying regular reply, not no reply from a configured support team.",
  schema,
  availability: "always",
  toolsets: ["analytics"],
  annotations: readAnnotations(),
  handler: async ({ start_date, end_date, category_ids }, _extra, ctx) => {
    const accessError = requireAnalyticsAccess(ctx);
    if (accessError) return accessError;
    try {
      const { base, client } = ctx.siteState.ensureSelectedSite();
      const data = await withRateLimit(`discourse-api:${base}`, () => client.get(`/admin/plugins/solved/dashboard-support.json${queryString({ start_date, end_date, category_ids })}`), 200) as any;
      return jsonResponse({ ...data, semantics: { resolved: "has an accepted answer", in_progress: "unsolved with at least one qualifying regular reply", unanswered: "unsolved with no qualifying regular reply", cache_minutes: 30 } });
    } catch (error) {
      return pluginError("Failed to get support dashboard", "discourse-solved", error);
    }
  },
});
