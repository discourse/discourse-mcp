import { z } from "zod";
import { defineTool } from "../../definition.js";
import { jsonResponse, isZodError, zodError } from "../../../util/json_response.js";
import { WORKFLOWS_BASE, workflowIdSchema, requireWorkflowAdmin, workflowError } from "./common.js";
const schema = z.object({ workflow_id: workflowIdSchema });
export const listWorkflowVersionsTool = defineTool({
  name: "discourse_list_workflow_versions", title: "List Workflow Versions", description: "List workflow version history and UUIDs available for restore.", schema,
  availability: "always", toolsets: ["workflows"], handler: async (input: unknown, _extra, ctx) => { try {
    const { workflow_id } = schema.parse(input); const denied = requireWorkflowAdmin(ctx.siteState); if (denied) return denied; const { client } = ctx.siteState.ensureSelectedSite();
    const data: any = await client.get(`${WORKFLOWS_BASE}/workflows/${workflow_id}/versions.json`);
    const versions = (data?.versions ?? []).map((v: any) => ({ id: v.id ?? v.version_id, version_id: v.version_id ?? v.id, created_at: v.created_at, created_by: v.created_by && { id: v.created_by.id, username: v.created_by.username }, published: v.published }));
    return jsonResponse({ versions });
  } catch (e) { if (isZodError(e)) return zodError(e); return workflowError("list workflow versions", e); } },
});
