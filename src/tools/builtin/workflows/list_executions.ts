import { z } from "zod";
import { defineTool } from "../../definition.js";
import { jsonResponse, paginatedResponse, isZodError, zodError } from "../../../util/json_response.js";
import { WORKFLOWS_BASE, queryString, workflowIdSchema, requireWorkflowAdmin, workflowError } from "./common.js";
const schema = z.object({ workflow_id: workflowIdSchema.optional(), cursor: z.string().optional(), limit: z.number().int().min(1).max(100).default(25) });
export const listWorkflowExecutionsTool = defineTool({
  name: "discourse_list_workflow_executions", title: "List Workflow Executions", description: "List global or per-workflow execution history.", schema,
  availability: "always", toolsets: ["workflows"], handler: async (input: unknown, _extra, ctx) => { try {
    const args = schema.parse(input); const denied = requireWorkflowAdmin(ctx.siteState); if (denied) return denied; const { client } = ctx.siteState.ensureSelectedSite();
    const route = args.workflow_id === undefined ? `${WORKFLOWS_BASE}/executions.json` : `${WORKFLOWS_BASE}/workflows/${args.workflow_id}/executions.json`;
    const data: any = await client.get(`${route}${queryString({ cursor: args.cursor, limit: args.limit })}`); const executions = data?.executions ?? [];
    return jsonResponse(paginatedResponse("executions", executions, { limit: args.limit, has_more: Boolean(data?.meta?.load_more_executions), next_cursor: data?.meta?.load_more_executions ?? null }));
  } catch (e) { if (isZodError(e)) return zodError(e); return workflowError("list workflow executions", e); } },
});
