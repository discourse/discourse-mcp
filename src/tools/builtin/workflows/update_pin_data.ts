import { z } from "zod";
import { defineTool } from "../../definition.js";
import { isZodError, zodError, rateLimit, jsonResponse } from "../../../util/json_response.js";
import { jsonRecordSchema, requireWorkflowWrite, WORKFLOWS_BASE, workflowError, workflowIdSchema } from "./common.js";
const schema = z.object({ workflow_id: workflowIdSchema, node_name: z.string().min(1), items: z.array(z.object({ json: jsonRecordSchema })).optional() });
export const updateWorkflowPinDataTool = defineTool({ name: "discourse_update_workflow_pin_data", title: "Update Workflow Pin Data", description: "Pin test items to a node name, or omit items to unpin it.", schema, availability: "writes_enabled", toolsets: ["workflows"],
  handler: async (input: unknown, _extra, ctx, opts) => { try { const args = schema.parse(input); const denied = requireWorkflowWrite(ctx.siteState, opts); if (denied) return denied; await rateLimit("workflow"); const { client } = ctx.siteState.ensureSelectedSite(); const body: Record<string, unknown> = { node_name: args.node_name }; if (args.items !== undefined) body.items = args.items; await client.put(`${WORKFLOWS_BASE}/workflows/${args.workflow_id}/pin-data.json`, body); return jsonResponse({ ok: true, node_name: args.node_name, pinned: args.items !== undefined }); } catch (e) { if (isZodError(e)) return zodError(e); return workflowError("update workflow pin data", e); } },
});
