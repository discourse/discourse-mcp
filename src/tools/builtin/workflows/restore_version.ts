import { z } from "zod";
import { defineTool } from "../../definition.js";
import { jsonResponse, isZodError, zodError, rateLimit } from "../../../util/json_response.js";
import { requireWorkflowWrite, WORKFLOWS_BASE, workflowError, workflowIdSchema } from "./common.js";
const schema = z.object({ workflow_id: workflowIdSchema, version_id: z.string().uuid() });
export const restoreWorkflowVersionTool = defineTool({ name: "discourse_restore_workflow_version", title: "Restore Workflow Version", description: "Restore a historical workflow version by UUID into the draft.", schema, availability: "writes_enabled", toolsets: ["workflows"],
  handler: async (input: unknown, _extra, ctx, opts) => { try { const { workflow_id, version_id } = schema.parse(input); const denied = requireWorkflowWrite(ctx.siteState, opts); if (denied) return denied; await rateLimit("workflow"); const { client } = ctx.siteState.ensureSelectedSite(); return jsonResponse(await client.post(`${WORKFLOWS_BASE}/workflows/${workflow_id}/versions/${version_id}/restore.json`, {})); } catch (e) { if (isZodError(e)) return zodError(e); return workflowError("restore workflow version", e); } },
});
