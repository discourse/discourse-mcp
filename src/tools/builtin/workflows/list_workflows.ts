import { z } from "zod";
import { defineTool } from "../../definition.js";
import { jsonResponse, paginatedResponse, isZodError, zodError } from "../../../util/json_response.js";
import { WORKFLOWS_BASE, queryString, requireWorkflowAdmin, workflowError } from "./common.js";

const schema = z.object({
  filter: z.string().optional(), trigger_type: z.string().optional(), tags: z.array(z.string()).optional(),
  cursor: z.string().optional(), limit: z.number().int().min(1).max(100).default(25), exclude_id: z.string().optional(),
});
export const listWorkflowsTool = defineTool({
  name: "discourse_list_workflows", title: "List Workflows",
  description: "List compact Discourse Workflow summaries. Requires an admin API key.", schema,
  availability: "always", toolsets: ["workflows"],
  handler: async (input: unknown, _extra, ctx) => { try {
    const args = schema.parse(input); const denied = requireWorkflowAdmin(ctx.siteState); if (denied) return denied;
    const { client } = ctx.siteState.ensureSelectedSite();
    const data: any = await client.get(`${WORKFLOWS_BASE}/workflows.json${queryString(args)}`);
    const rows = (data?.workflows ?? []).map((workflow: any) => ({
      id: workflow.id, name: workflow.name, tags: workflow.tags, has_unpublished_changes: workflow.has_unpublished_changes,
      last_execution_status: workflow.last_execution_status, last_execution_at: workflow.last_execution_at, timezone: workflow.timezone,
      triggers: (workflow.nodes ?? []).filter((node: any) => String(node.type ?? "").startsWith("trigger:"))
        .map((node: any) => ({ id: node.id, name: node.name, type: node.type })),
    }));
    const meta = data?.meta ?? {};
    return jsonResponse(paginatedResponse("workflows", rows, { total: meta.total_rows_workflows, limit: args.limit,
      has_more: Boolean(meta.load_more_workflows), next_cursor: meta.load_more_workflows ?? null }));
  } catch (e) { if (isZodError(e)) return zodError(e); return workflowError("list workflows", e); } },
});
