import { z } from "zod";
import { defineTool } from "../../definition.js";
import { jsonResponse, isZodError, zodError } from "../../../util/json_response.js";
import { WORKFLOWS_BASE, workflowIdSchema, requireWorkflowAdmin, workflowError } from "./common.js";
const schema = z.object({ id: workflowIdSchema.describe("Execution ID") });
export const getWorkflowExecutionTool = defineTool({
  name: "discourse_get_workflow_execution", title: "Get Workflow Execution", description: "Poll an execution for status, errors, timing, trigger data, and steps.", schema,
  availability: "always", toolsets: ["workflows"], handler: async (input: unknown, _extra, ctx) => { try {
    const { id } = schema.parse(input); const denied = requireWorkflowAdmin(ctx.siteState); if (denied) return denied; const { client } = ctx.siteState.ensureSelectedSite();
    return jsonResponse(await client.get(`${WORKFLOWS_BASE}/executions/${id}.json`));
  } catch (e) { if (isZodError(e)) return zodError(e); return workflowError("get workflow execution", e); } },
});
