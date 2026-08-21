import { z } from "zod";
import { defineTool } from "../../definition.js";
import { isZodError, zodError, rateLimit, jsonResponse } from "../../../util/json_response.js";
import { executionResult, jsonRecordSchema, requireWorkflowWrite, WORKFLOWS_BASE, workflowError, workflowIdSchema } from "./common.js";
const schema = z.object({ workflow_id: workflowIdSchema, trigger_node_id: z.string().min(1), trigger_data: jsonRecordSchema.optional() });
export const runWorkflowTool = defineTool({ name: "discourse_run_workflow", title: "Run Workflow Draft", description: "Run the current unpublished draft asynchronously. This can create posts, send chat, or call external HTTP; poll the returned execution id.", schema, availability: "writes_enabled", toolsets: ["workflows"],
  handler: async (input: unknown, _extra, ctx, opts) => { try { const args = schema.parse(input); const denied = requireWorkflowWrite(ctx.siteState, opts); if (denied) return denied; await rateLimit("workflow"); const { client } = ctx.siteState.ensureSelectedSite(); return jsonResponse(executionResult(await client.post(`${WORKFLOWS_BASE}/executions.json`, args))); } catch (e) { if (isZodError(e)) return zodError(e); return workflowError("run workflow", e); } },
});
