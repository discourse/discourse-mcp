import { z } from "zod";
import { defineTool } from "../../definition.js";
import { jsonResponse, isZodError, zodError, rateLimit } from "../../../util/json_response.js";
import { requireWorkflowWrite, WORKFLOWS_BASE, workflowError, workflowIdSchema } from "./common.js";
const schema = z.object({ id: workflowIdSchema });
export const deleteWorkflowTool = defineTool({ name: "discourse_delete_workflow", title: "Delete Workflow", description: "Permanently delete a workflow. Fails when another workflow calls it.", schema, availability: "writes_enabled", toolsets: ["workflows"],
  handler: async (input: unknown, _extra, ctx, opts) => { try { const { id } = schema.parse(input); const denied = requireWorkflowWrite(ctx.siteState, opts); if (denied) return denied; await rateLimit("workflow"); const { client } = ctx.siteState.ensureSelectedSite(); await client.delete(`${WORKFLOWS_BASE}/workflows/${id}.json`); return jsonResponse({ deleted: true, id }); } catch (e) { if (isZodError(e)) return zodError(e); return workflowError("delete workflow", e); } },
});
