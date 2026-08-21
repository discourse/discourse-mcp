import { z } from "zod";
import { defineTool } from "../../definition.js";
import { jsonResponse, isZodError, zodError } from "../../../util/json_response.js";
import { WORKFLOWS_BASE, authoringPlaybook, requireWorkflowAdmin, workflowError } from "./common.js";
const schema = z.object({ kind: z.enum(["trigger", "action", "condition", "flow"]).optional(), identifier: z.string().optional(), manually_triggerable_only: z.boolean().optional() });
function outputKeys(node: any): string[] {
  const value = node.outputs ?? node.ports?.outputs ?? node.ports ?? {};
  if (Array.isArray(value)) return value.map((item) => typeof item === "string" ? item : item?.type ?? item?.name ?? item?.key).filter(Boolean);
  return Object.keys(value ?? {});
}
export const listWorkflowNodeTypesTool = defineTool({
  name: "discourse_list_workflow_node_types", title: "List Workflow Node Types", description: `List a slim catalog, or pass identifier for schemas, ports, and output contracts. ${authoringPlaybook}`,
  schema, availability: "always", toolsets: ["workflows"], handler: async (input: unknown, _extra, ctx) => { try {
    const args = schema.parse(input); const denied = requireWorkflowAdmin(ctx.siteState); if (denied) return denied;
    const { client } = ctx.siteState.ensureSelectedSite(); const data: any = await client.get(`${WORKFLOWS_BASE}/node-types.json`);
    const rawNodeTypes = data?.node_types ?? [];
    let nodes: any[] = Array.isArray(rawNodeTypes)
      ? rawNodeTypes
      : Object.entries(rawNodeTypes).map(([identifier, node]) => ({ identifier, ...(node as Record<string, unknown>) }));
    if (args.kind) nodes = nodes.filter((node) => node.kind === args.kind || String(node.identifier ?? "").startsWith(`${args.kind}:`));
    if (args.manually_triggerable_only) nodes = nodes.filter((node) => node.manually_triggerable);
    if (args.identifier) nodes = nodes.filter((node) => node.identifier === args.identifier);
    const node_types = nodes.map((node) => args.identifier ? {
      identifier: node.identifier, kind: node.kind, available: node.available, manually_triggerable: node.manually_triggerable, label: node.label,
      properties: node.properties, inputs: node.inputs, outputs: node.outputs, ports: node.ports, output_contracts: node.output_contracts, capabilities: node.capabilities,
    } : { identifier: node.identifier, kind: node.kind, available: node.available, manually_triggerable: node.manually_triggerable, label: node.label, outputs: outputKeys(node) });
    return jsonResponse({ node_types, credential_types: args.identifier ? data?.credential_types : undefined, expression_context: args.identifier ? data?.expression_context : undefined });
  } catch (e) { if (isZodError(e)) return zodError(e); return workflowError("list workflow node types", e); } },
});
