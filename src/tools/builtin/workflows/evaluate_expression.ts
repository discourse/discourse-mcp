import { z } from "zod";
import { defineTool } from "../../definition.js";
import { jsonResponse, isZodError, zodError } from "../../../util/json_response.js";
import { WORKFLOWS_BASE, workflowIdSchema, requireWorkflowAdmin, workflowError } from "./common.js";
const schema = z.object({ template: z.string(), workflow_id: workflowIdSchema.optional(), node_id: z.string().optional() });
export const evaluateWorkflowExpressionTool = defineTool({
  name: "discourse_evaluate_workflow_expression", title: "Evaluate Workflow Expression", description: "Evaluate a workflow expression without mutating the forum. Interpolating expressions start with =.", schema,
  availability: "always", toolsets: ["workflows"], handler: async (input: unknown, _extra, ctx) => { try {
    const args = schema.parse(input); const denied = requireWorkflowAdmin(ctx.siteState); if (denied) return denied; const { client } = ctx.siteState.ensureSelectedSite();
    return jsonResponse(await client.post(`${WORKFLOWS_BASE}/expressions/evaluate.json`, args));
  } catch (e) { if (isZodError(e)) return zodError(e); return workflowError("evaluate workflow expression", e); } },
});
