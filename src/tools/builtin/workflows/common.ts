import { z } from "zod";
import type { SiteState } from "../../../site/state.js";
import type { ToolRegistrationOptions } from "../../types.js";
import { requireAdminAccess, requireWriteAccess } from "../../../util/access.js";
import { HttpError } from "../../../http/client.js";
import { jsonError } from "../../../util/json_response.js";
import { toConnectionList, type NestedConnections } from "./graph.js";

export const WORKFLOWS_BASE = "/admin/plugins/discourse-workflows";
export const workflowIdSchema = z.union([
  z.string().regex(/^\d+$/, "ID must be numeric"),
  z.number().int().positive(),
]);
export const jsonRecordSchema = z.record(z.unknown());
export const authoringPlaybook = `Authoring loop: inspect the slim node catalog, request identifiers for schemas and output keys, resolve entity ids, create from a template or complete graph, GET before edits, test the draft, then publish. Interpolating strings start with =. Filter/if use leftValue/rightValue and output ports true/false. Connection type is the source output key, not always main. Prefer declarative nodes over action:code. Manual runs execute the current draft. Omitting a node on whole-graph update deletes it. nodes and connections must always be sent together.`;

export function requireWorkflowAdmin(siteState: SiteState) {
  return requireAdminAccess(siteState);
}

export function requireWorkflowWrite(siteState: SiteState, opts: ToolRegistrationOptions) {
  return requireAdminAccess(siteState) ?? requireWriteAccess(siteState, opts.allowWrites);
}

export function workflowError(action: string, error: unknown) {
  if (error instanceof HttpError) {
    if (error.status === 404) return jsonError(`Failed to ${action}: workflows plugin disabled, item not found, or the API key is not admin`);
    const body = error.body as { errors?: unknown; error?: unknown } | undefined;
    const details = body?.errors ?? body?.error;
    if (details) return jsonError(`Failed to ${action}: ${Array.isArray(details) ? details.join("; ") : String(details)}`, { status: error.status });
    if (error.status === 429) return jsonError(`Failed to ${action}: rate limited; retry`, { status: 429 });
  }
  return jsonError(`Failed to ${action}: ${error instanceof Error ? error.message : String(error)}`);
}

export function queryString(values: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) value.forEach((item) => params.append(`${key}[]`, String(item)));
    else params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function shapeWorkflow(raw: any) {
  const workflow = raw?.workflow ?? raw;
  const shrinkUser = (user: any) => user ? { id: user.id, username: user.username } : user;
  return {
    ...workflow,
    created_by: shrinkUser(workflow?.created_by),
    updated_by: shrinkUser(workflow?.updated_by),
    connections: workflow?.connections ?? {},
    connection_list: toConnectionList((workflow?.connections ?? {}) as NestedConnections),
  };
}

export function executionResult(raw: any) {
  const execution = raw?.execution ?? raw;
  return {
    execution: {
      id: execution?.id,
      workflow_id: execution?.workflow_id,
      status: execution?.status ?? "pending",
    },
    poll: "discourse_get_workflow_execution",
  };
}
