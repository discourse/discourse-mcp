import { z } from "zod";
import { defineTool } from "../../definition.js";
import { jsonResponse, isZodError, zodError, rateLimit } from "../../../util/json_response.js";
import { requireWorkflowWrite, WORKFLOWS_BASE, workflowError, workflowIdSchema } from "./common.js";
const schema = z.object({ id: workflowIdSchema });
export const discardWorkflowDraftTool = defineTool({ name: "discourse_discard_workflow_draft", title: "Discard Workflow Draft", description: "Replace the draft with its published snapshot. Requires an existing published version.", schema, availability: "writes_enabled", toolsets: ["workflows"],
  handler: async (input: unknown, _extra, ctx, opts) => { try { const { id } = schema.parse(input); const denied = requireWorkflowWrite(ctx.siteState, opts); if (denied) return denied; await rateLimit("workflow"); const { client } = ctx.siteState.ensureSelectedSite(); const data = await client.post(`${WORKFLOWS_BASE}/workflows/${id}/discard-draft.json`, {}); return jsonResponse(data); } catch (e) { if (isZodError(e)) return zodError(e); return workflowError("discard workflow draft", e); } },
});
