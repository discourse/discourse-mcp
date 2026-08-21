import { z } from "zod";
import { defineTool } from "../../definition.js";
import { jsonResponse, paginatedResponse, isZodError, zodError } from "../../../util/json_response.js";
import { WORKFLOWS_BASE, queryString, requireWorkflowAdmin, workflowError } from "./common.js";
const schema = z.object({ type: z.string().optional(), cursor: z.string().optional(), limit: z.number().int().min(1).max(100).default(25) });
export const listWorkflowCredentialsTool = defineTool({
  name: "discourse_list_workflow_credentials", title: "List Workflow Credentials", description: "List workflow credentials with secrets redacted. Credential creation remains in the admin UI.", schema,
  availability: "always", toolsets: ["workflows"], handler: async (input: unknown, _extra, ctx) => { try {
    const args = schema.parse(input); const denied = requireWorkflowAdmin(ctx.siteState); if (denied) return denied; const { client } = ctx.siteState.ensureSelectedSite();
    const data: any = await client.get(`${WORKFLOWS_BASE}/credentials.json${queryString(args)}`); let credentials = data?.credentials ?? [];
    if (args.type) credentials = credentials.filter((credential: any) => credential.type === args.type || credential.credential_type === args.type);
    return jsonResponse(paginatedResponse("credentials", credentials, { limit: args.limit, has_more: Boolean(data?.meta?.load_more_credentials), next_cursor: data?.meta?.load_more_credentials ?? null }));
  } catch (e) { if (isZodError(e)) return zodError(e); return workflowError("list workflow credentials", e); } },
});
