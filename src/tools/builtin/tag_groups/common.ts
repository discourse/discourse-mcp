import { createHash } from "node:crypto";
import { HttpError, type HttpClient } from "../../../http/client.js";
import type { SiteState } from "../../../site/state.js";
import type { ToolRegistrationOptions } from "../../types.js";
import { fetchAllGroups } from "../../../site/directories.js";
import { requireAdminAccess, requireWriteAccess } from "../../../util/access.js";
import { jsonError, withRateLimit } from "../../../util/json_response.js";
import {
  permissionsSchema,
  tagGroupRecordSchema,
  tagRecordSchema,
  type Permissions,
  type TagGroupRecord,
  type TagSelector,
} from "./schemas.js";

export const createAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
} as const;

export const replacementAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
} as const;

export const deleteAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
} as const;

export function requireTagGroupRead(siteState: SiteState) {
  return requireAdminAccess(siteState);
}

export function requireTagGroupWrite(siteState: SiteState, opts: ToolRegistrationOptions) {
  return requireWriteAccess(siteState, opts.allowWrites) ?? requireAdminAccess(siteState);
}

type MutableTagGroupState = Pick<TagGroupRecord, "name" | "tags" | "parent_tag" | "one_per_topic" | "permissions">;

function canonicalMutable(group: MutableTagGroupState) {
  return {
    name: group.name,
    tag_ids: group.tags.map((tag) => tag.id),
    parent_tag_id: group.parent_tag?.id ?? null,
    one_per_topic: group.one_per_topic,
    permissions: Object.entries(group.permissions)
      .map(([groupId, permission]) => [Number(groupId), permission] as const)
      .sort(([left], [right]) => left - right),
  };
}

export function tagGroupStateHash(group: MutableTagGroupState): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalMutable(group)))
    .digest("hex");
}

export function normalizeTag(raw: unknown) {
  const parsed = tagRecordSchema.parse(raw);
  return { id: parsed.id, name: parsed.name, slug: parsed.slug };
}

export function normalizeTagGroup(raw: unknown): TagGroupRecord {
  const source = raw as any;
  const tags = Array.isArray(source?.tags) ? source.tags.map(normalizeTag) : source?.tags;
  const parentSource = Array.isArray(source?.parent_tag)
    ? source.parent_tag[0] ?? null
    : source?.parent_tag ?? null;
  const parentTag = parentSource === null ? null : normalizeTag(parentSource);
  const withoutHash = {
    id: source?.id,
    name: source?.name,
    tags,
    parent_tag: parentTag,
    one_per_topic: source?.one_per_topic,
    permissions: permissionsSchema.parse(source?.permissions),
  };
  return tagGroupRecordSchema.parse({
    ...withoutHash,
    state_hash: tagGroupStateHash(withoutHash as MutableTagGroupState),
  });
}

export function unwrapTagGroup(body: unknown): TagGroupRecord {
  return normalizeTagGroup((body as any)?.tag_group);
}

export async function getTagGroup(client: Pick<HttpClient, "get">, id: number, signal?: AbortSignal): Promise<TagGroupRecord> {
  return unwrapTagGroup(await client.get(`/tag_groups/${id}.json`, { signal }));
}

export async function listTagGroups(client: Pick<HttpClient, "get">, signal?: AbortSignal): Promise<TagGroupRecord[]> {
  const body = await client.get("/tag_groups.json", { signal }) as any;
  if (!Array.isArray(body?.tag_groups)) throw new Error("Malformed tag-group list response");
  return body.tag_groups
    .map(normalizeTagGroup)
    .sort((left: TagGroupRecord, right: TagGroupRecord) => left.name.localeCompare(right.name));
}

export async function tagGroupMutation<T>(base: string, operation: () => Promise<T>): Promise<T> {
  return withRateLimit(`tag-groups:${base}`, operation, 1000);
}

export function outcomeUnknown(action: string, id: number, message: string) {
  return jsonError(`${action}: mutation may have been dispatched but authoritative post-state could not be proven; do not retry blindly`, {
    code: "outcome_unknown",
    id,
    detail: message.slice(0, 300),
    retryable: false,
  });
}

export function conflictError(id: number, current: TagGroupRecord) {
  return jsonError("Tag group changed since the supplied expected_state_hash; fetch fresh state and review before retrying", {
    code: "state_conflict",
    id,
    current_state_hash: current.state_hash,
    retryable: false,
  });
}

export function tagGroupError(action: string, error: unknown) {
  if (error instanceof HttpError) {
    const codes: Record<number, string> = {
      401: "authentication_required",
      403: "insufficient_permission_or_tagging_disabled",
      404: "not_staff_hidden_or_not_found",
      422: "invalid_parameters",
      429: "rate_limited",
    };
    return jsonError(`${action}: ${error.message}`, {
      code: codes[error.status] ?? "upstream_error",
      status: error.status,
      ...(error.status === 429 ? { retryable: true } : {}),
      ...(error.status === 403 ? { possible_causes: ["tagging is disabled for writes", "credential lacks staff or scoped API-key authority"] } : {}),
      ...(action.toLowerCase().includes("delete") && error.status === 403
        ? { scoped_api_key_limitation: "The Discourse scoped tag_groups action map may not permit delete" }
        : {}),
    });
  }
  return jsonError(`${action}: ${error instanceof Error ? error.message : String(error)}`, {
    code: "request_failed",
  });
}

export interface ResolvedSelector {
  payload: { id: number } | { name: string };
  identity: string;
  creates: boolean;
}

function tagRows(body: unknown): Array<{ id: number; name: string }> {
  const source = body as any;
  const rows = [
    ...(Array.isArray(source?.tags)
      ? source.tags
      : Array.isArray(source?.results)
        ? source.results
        : []),
    ...(Array.isArray(source?.extras?.tag_groups)
      ? source.extras.tag_groups.flatMap((group: any) => Array.isArray(group?.tags) ? group.tags : [])
      : []),
  ];
  return rows.flatMap((raw: any) => {
    const id = raw?.id;
    const name = raw?.name ?? raw?.text;
    return Number.isInteger(id) && id > 0 && typeof name === "string" && name.length > 0
      ? [{ id, name }]
      : [];
  });
}

/** Resolve IDs before writes because Discourse silently ignores unknown tag IDs. */
export async function resolveTagSelectors(
  client: Pick<HttpClient, "get">,
  selectors: TagSelector[],
  allowTagCreation: boolean,
  signal?: AbortSignal,
  knownTags: Array<{ id: number; name: string }> = [],
): Promise<ResolvedSelector[]> {
  const inventory = [...tagRows(await client.get("/tags.json", { signal })), ...knownTags];
  const byId = new Map(inventory.map((tag) => [tag.id, tag]));
  const byName = new Map(inventory.map((tag) => [tag.name.toLocaleLowerCase("en-US"), tag]));
  const result: ResolvedSelector[] = [];
  const identities = new Set<string>();
  let individualLookups = 0;

  for (const selector of selectors) {
    let resolved: ResolvedSelector;
    if ("id" in selector) {
      let tag = byId.get(selector.id);
      if (!tag) {
        if (++individualLookups > 40) throw new Error("Too many tag IDs require individual authoritative validation");
        let body: any;
        try {
          body = await client.get(`/tag/${selector.id}/info.json`, { signal });
        } catch (error) {
          if (error instanceof HttpError && error.status === 404) {
            throw new Error(`Unknown or invisible tag ID ${selector.id}`);
          }
          throw error;
        }
        const detail = body?.tag_info;
        if (detail?.id !== selector.id || typeof detail?.name !== "string" || detail.name.length === 0) {
          throw new Error(`Unknown or invisible tag ID ${selector.id}`);
        }
        tag = { id: detail.id, name: detail.name };
        byId.set(tag.id, tag);
        byName.set(tag.name.toLocaleLowerCase("en-US"), tag);
      }
      resolved = { payload: { id: tag.id }, identity: `id:${tag.id}`, creates: false };
    } else {
      const existing = byName.get(selector.name.toLocaleLowerCase("en-US"));
      resolved = existing
        ? { payload: { id: existing.id }, identity: `id:${existing.id}`, creates: false }
        : { payload: { name: selector.name }, identity: `name:${selector.name.toLocaleLowerCase("en-US")}`, creates: true };
    }
    if (resolved.creates && !allowTagCreation) {
      throw new Error(`allow_tag_creation must be true before creating persistent tag '${"name" in selector ? selector.name : ""}'`);
    }
    if (identities.has(resolved.identity)) throw new Error("Tag selectors must resolve to unique tags");
    identities.add(resolved.identity);
    result.push(resolved);
  }
  return result;
}

export async function validatePermissionGroups(
  client: HttpClient,
  permissions: Permissions,
  signal?: AbortSignal,
): Promise<void> {
  const ids = Object.keys(permissions).map(Number).filter((id) => id !== 0);
  if (ids.length === 0) return;
  const directory = await fetchAllGroups(client, { signal });
  if (!directory.meta.complete) {
    throw new Error(`Cannot safely validate permission group IDs: directory is incomplete (${directory.meta.truncated_reason ?? "unknown"})`);
  }
  const known = new Set(directory.groups.map((group) => group.id as number));
  const unknown = ids.filter((id) => !known.has(id));
  if (unknown.length) throw new Error(`Unknown or invisible permission group IDs: ${unknown.join(", ")}`);
}

export function selectorsConflict(members: ResolvedSelector[], parent?: ResolvedSelector | null): boolean {
  return Boolean(parent && members.some((member) => member.identity === parent.identity));
}

export function completeTagGroupBody(
  state: {
    name: string;
    tags: ResolvedSelector[];
    parent: ResolvedSelector | null;
    onePerTopic: boolean;
    permissions: Permissions;
  },
) {
  return {
    name: state.name,
    tags: state.tags.map((selector) => selector.payload),
    parent_tag: state.parent ? [state.parent.payload] : [],
    one_per_topic: state.onePerTopic,
    permissions: state.permissions,
  };
}

export function currentSelectors(group: TagGroupRecord): { tags: TagSelector[]; parent: TagSelector | null } {
  return {
    tags: group.tags.map((tag) => ({ id: tag.id })),
    parent: group.parent_tag ? { id: group.parent_tag.id } : null,
  };
}

export function samePermissions(left: Permissions, right: Permissions): boolean {
  return JSON.stringify(Object.entries(left).sort()) === JSON.stringify(Object.entries(right).sort());
}

export function isNotFound(error: unknown): boolean {
  return error instanceof HttpError && error.status === 404;
}
