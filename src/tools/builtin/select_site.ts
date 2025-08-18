import { z } from "zod";
import type { RegisterFn } from "../types.js";
import { tryRegisterRemoteTools } from "../remote/tool_exec_api.js";

export const registerSelectSite: RegisterFn = (server, ctx, opts) => {
  const schema = z.object({
    site: z.string().url().describe("Base URL of the Discourse site"),
  });

  server.registerTool(
    "discourse_select_site",
    {
      title: "Select Site",
      description: "Validate and select a Discourse site for subsequent tool calls.",
      inputSchema: schema.shape,
    },
    async ({ site }, _extra: any) => {
      try {
        const { base, client } = ctx.siteState.buildClientForSite(site);
        // Validate by fetching /about.json
        const about = (await client.get(`/about.json`)) as any;
        const title = about?.about?.title || about?.title || base;
        ctx.siteState.selectSite(base);

        // Attempt remote tool discovery if enabled
        if (opts.toolsMode && opts.toolsMode !== "discourse_api_only") {
          await tryRegisterRemoteTools(server, ctx.siteState, ctx.logger);
        }

        const text = `Selected site: ${base}\nTitle: ${title}`;
        return { content: [{ type: "text", text }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Failed to select site: ${e?.message || String(e)}` }], isError: true };
      }
    }
  );
};
