import { z } from "zod";
import { defineTool } from "../../definition.js";
import { jsonResponse, isZodError, zodError } from "../../../util/json_response.js";
import { WORKFLOWS_BASE, authoringPlaybook, requireWorkflowAdmin, workflowError } from "./common.js";
const schema = z.object({ id: z.string().regex(/^[a-z0-9_-]+$/).optional() });
export const listWorkflowTemplatesTool = defineTool({
  name: "discourse_list_workflow_templates", title: "List Workflow Templates", description: `List templates or retrieve a complete template graph by id. ${authoringPlaybook}`,
  schema, availability: "always", toolsets: ["workflows"], handler: async (input: unknown, _extra, ctx) => { try {
    const { id } = schema.parse(input); const denied = requireWorkflowAdmin(ctx.siteState); if (denied) return denied; const { client } = ctx.siteState.ensureSelectedSite();
    return jsonResponse(await client.get(id ? `${WORKFLOWS_BASE}/templates/${id}.json` : `${WORKFLOWS_BASE}/templates.json`));
  } catch (e) { if (isZodError(e)) return zodError(e); return workflowError("list workflow templates", e); } },
});
