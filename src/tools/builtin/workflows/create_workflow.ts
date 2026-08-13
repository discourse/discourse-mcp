import { z } from "zod";
import { defineTool } from "../../definition.js";
import { jsonResponse, isZodError, zodError, rateLimit } from "../../../util/json_response.js";
import { authoringPlaybook, jsonRecordSchema, requireWorkflowWrite, shapeWorkflow, WORKFLOWS_BASE, workflowError } from "./common.js";
import { assertPairedGraph, connectionsSchema, toNestedConnections, workflowNodeSchema } from "./graph.js";
const schema = z.object({
  name: z.string().min(1), nodes: z.array(workflowNodeSchema).optional(), connections: connectionsSchema.optional(),
  tags: z.array(z.string()).optional(), static_data: jsonRecordSchema.optional(), template_id: z.string().regex(/^[a-z0-9_-]+$/).optional(),
});
export const createWorkflowTool = defineTool({
  name: "discourse_create_workflow", title: "Create Workflow", description: `Create a draft from a complete small graph or template. Prefer a complete graph over blank creation. ${authoringPlaybook}`,
  schema, availability: "writes_enabled", toolsets: ["workflows"], handler: async (input: unknown, _extra, ctx, opts) => { try {
    const args = schema.parse(input); const denied = requireWorkflowWrite(ctx.siteState, opts); if (denied) return denied;
    assertPairedGraph(args.nodes, args.connections); if (args.template_id && args.nodes) throw new Error("template_id cannot be combined with nodes/connections");
    const { client } = ctx.siteState.ensureSelectedSite(); let nodes = args.nodes; let connections = args.connections;
    if (args.template_id) { const raw: any = await client.get(`${WORKFLOWS_BASE}/templates/${args.template_id}.json`); const template = raw?.template ?? raw; nodes = template.nodes ?? []; connections = template.connections ?? {}; }
    await rateLimit("workflow"); const workflow: Record<string, unknown> = { name: args.name };
    if (nodes && connections) { workflow.nodes = nodes; workflow.connections = toNestedConnections(connections); }
    if (args.tags !== undefined) workflow.tags = args.tags; if (args.static_data !== undefined) workflow.static_data = args.static_data;
    return jsonResponse(shapeWorkflow(await client.post(`${WORKFLOWS_BASE}/workflows.json`, { workflow })));
  } catch (e) { if (isZodError(e)) return zodError(e); return workflowError("create workflow", e); } },
});
