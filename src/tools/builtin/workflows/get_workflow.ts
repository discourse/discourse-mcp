import { z } from "zod";
import { defineTool } from "../../definition.js";
import { jsonResponse, isZodError, zodError } from "../../../util/json_response.js";
import { WORKFLOWS_BASE, workflowIdSchema, requireWorkflowAdmin, shapeWorkflow, workflowError } from "./common.js";
const schema = z.object({ id: workflowIdSchema.describe("Workflow ID") });
export const getWorkflowTool = defineTool({
  name: "discourse_get_workflow", title: "Get Workflow", description: "Get the complete round-trippable workflow graph. GET immediately before updating it.",
  schema, availability: "always", toolsets: ["workflows"], handler: async (input: unknown, _extra, ctx) => { try {
    const { id } = schema.parse(input); const denied = requireWorkflowAdmin(ctx.siteState); if (denied) return denied;
    const { client } = ctx.siteState.ensureSelectedSite(); return jsonResponse(shapeWorkflow(await client.get(`${WORKFLOWS_BASE}/workflows/${id}.json`)));
  } catch (e) { if (isZodError(e)) return zodError(e); return workflowError("get workflow", e); } },
});
