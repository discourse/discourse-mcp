import { z } from "zod";
import { defineTool } from "../definition.js";
import { tryRegisterRemoteTools } from "../remote/tool_exec_api.js";
import { jsonResponse, jsonError } from "../../util/json_response.js";

const schema = z.object({
  site: z.string().url().describe("Base URL of the Discourse site"),
});

export const selectSiteTool = defineTool({
  name: "discourse_select_site",
  title: "Select Site",
  description: "Validate and select a Discourse site. Returns JSON with site URL and title.",
  schema,
  availability: "site_selection",
  handler: async ({ site }, _extra, ctx, opts) => {
    try {
      const { base, client } = ctx.siteState.buildClientForSite(site);
      const about = (await client.get(`/about.json`)) as any;
      const title = about?.about?.title || about?.title || base;
      ctx.siteState.selectSite(base);

      if (opts.toolsMode && opts.toolsMode !== "discourse_api_only") {
        await tryRegisterRemoteTools(ctx.server, ctx.siteState, ctx.logger);
      }

      return jsonResponse({ site: base, title });
    } catch (e: any) {
      return jsonError(`Failed to select site: ${e?.message || String(e)}`);
    }
  },
});
