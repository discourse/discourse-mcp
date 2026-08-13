import { z } from "zod";
import { defineTool } from "../../definition.js";
import { jsonResponse, isZodError, zodError, rateLimit } from "../../../util/json_response.js";
import { authoringPlaybook, jsonRecordSchema, requireWorkflowWrite, shapeWorkflow, WORKFLOWS_BASE, workflowError, workflowIdSchema } from "./common.js";
import { applyWorkflowOperations, assertPairedGraph, connectionsSchema, toNestedConnections, workflowNodeSchema, workflowOperationSchema, type NestedConnections, type WorkflowNode } from "./graph.js";
const schema = z.object({
  id: workflowIdSchema, name: z.string().min(1).optional(), tags: z.array(z.string()).optional(), timezone: z.string().optional(),
  error_workflow_id: workflowIdSchema.nullable().optional(), static_data: jsonRecordSchema.optional(), published: z.boolean().optional(), autosaved: z.boolean().optional(),
  nodes: z.array(workflowNodeSchema).optional(), connections: connectionsSchema.optional(), operations: z.array(workflowOperationSchema).min(1).optional(),
});
export const updateWorkflowTool = defineTool({
  name: "discourse_update_workflow", title: "Update Workflow", description: `GET first. A replace PUT replaces the whole draft graph; omitted nodes are deleted. Use complete nodes+connections or operations[], never both. ${authoringPlaybook}`,
  schema, availability: "writes_enabled", toolsets: ["workflows"], handler: async (input: unknown, _extra, ctx, opts) => { try {
    const args = schema.parse(input); const denied = requireWorkflowWrite(ctx.siteState, opts); if (denied) return denied;
    assertPairedGraph(args.nodes, args.connections); if (args.operations && args.nodes) throw new Error("operations cannot be combined with nodes/connections");
    const supplied = Object.entries(args).some(([key, value]) => key !== "id" && value !== undefined); if (!supplied) throw new Error("No workflow fields to update");
    const { client } = ctx.siteState.ensureSelectedSite(); let nodes = args.nodes as WorkflowNode[] | undefined; let connections = args.connections ? toNestedConnections(args.connections) : undefined;
    if (args.nodes || args.operations) {
      const currentRaw: any = await client.get(`${WORKFLOWS_BASE}/workflows/${args.id}.json`); const current = currentRaw?.workflow ?? currentRaw;
      if (args.operations) { const applied = applyWorkflowOperations(current.nodes ?? [], current.connections ?? {}, args.operations); nodes = applied.nodes; connections = applied.connections; }
    }
    const metadata: Record<string, unknown> = {};
    for (const key of ["name", "tags", "timezone", "error_workflow_id", "static_data", "autosaved"] as const) if (args[key] !== undefined) metadata[key] = args[key];
    if (nodes && connections) { metadata.nodes = nodes; metadata.connections = connections as NestedConnections; }
    let response: any;
    if (Object.keys(metadata).length) { await rateLimit("workflow"); response = await client.put(`${WORKFLOWS_BASE}/workflows/${args.id}.json`, { workflow: metadata }); }
    if (args.published !== undefined) { await rateLimit("workflow"); const publish: Record<string, unknown> = { published: args.published }; if (args.name !== undefined) publish.name = args.name;
      response = await client.put(`${WORKFLOWS_BASE}/workflows/${args.id}.json`, { workflow: publish }); }
    return jsonResponse(shapeWorkflow(response ?? { id: args.id }));
  } catch (e) { if (isZodError(e)) return zodError(e); return workflowError("update workflow", e); } },
});
