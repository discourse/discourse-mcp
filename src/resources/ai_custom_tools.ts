import { requireAdminAccess } from "../util/access.js";
import type { ResourceContext, ResourceRegistrar } from "./registry.js";
import { GUIDE_RESOURCE_URI } from "../tools/builtin/ai_custom_tools/guide_data.js";
import { loadLiveAuthoringGuide } from "../tools/builtin/ai_custom_tools/guide.js";

export function registerAiCustomToolsAuthoringGuideResource(server: ResourceRegistrar, ctx: ResourceContext): void {
  server.resource(
    "ai_custom_tools_authoring_guide",
    GUIDE_RESOURCE_URI,
    { title: "Discourse AI Custom Tool Authoring Guide", description: "Authoritative selected-site JavaScript preamble and minimal MiniRacer tool template. Admin-only; intended for assistant authoring context.", mimeType: "text/javascript" },
    async (uri) => {
      const access = requireAdminAccess(ctx.siteState);
      if (access) throw new Error("Selected-site admin API credentials are required to read this resource.");
      try {
        const guide = await loadLiveAuthoringGuide(ctx.siteState);
        return { contents: [{ uri: uri.href, mimeType: "text/javascript", text: guide.text }] };
      } catch (error) {
        throw new Error(`Failed to load the live empty_tool preamble: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  );
}
