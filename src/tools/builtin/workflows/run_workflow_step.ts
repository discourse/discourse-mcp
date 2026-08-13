import { z } from "zod";
import { defineTool } from "../../definition.js";
import { isZodError, zodError, rateLimit, jsonResponse } from "../../../util/json_response.js";
import { executionResult, requireWorkflowWrite, WORKFLOWS_BASE, workflowError, workflowIdSchema } from "./common.js";
const schema = z.object({ workflow_id: workflowIdSchema, node_id: z.string().min(1) });
export const runWorkflowStepTool = defineTool({ name: "discourse_run_workflow_step", title: "Run Workflow Step", description: "Run one non-trigger, non-waiting draft node asynchronously. Requires upstream pin-data or a prior successful run.", schema, availability: "writes_enabled", toolsets: ["workflows"],
  handler: async (input: unknown, _extra, ctx, opts) => { try { const args = schema.parse(input); const denied = requireWorkflowWrite(ctx.siteState, opts); if (denied) return denied; await rateLimit("workflow"); const { client } = ctx.siteState.ensureSelectedSite(); return jsonResponse(executionResult(await client.post(`${WORKFLOWS_BASE}/step-executions.json`, args))); } catch (e) { if (isZodError(e)) return zodError(e); return workflowError("run workflow step", e); } },
});
