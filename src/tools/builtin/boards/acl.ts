import { z } from "zod";
import { HttpError, type HttpClient } from "../../../http/client.js";
import { fail } from "./common.js";
import { ownerIdSchema, type AclEntryInput } from "./schemas.js";

const automaticGroups: Record<string, number> = { everyone: 0, admins: 1, moderators: 2, staff: 3, anonymous_users: 4, logged_in_users: 5, trust_level_0: 10, trust_level_1: 11, trust_level_2: 12, trust_level_3: 13, trust_level_4: 14 };
export type PrincipalCache = Map<string, Promise<number>>;
async function resolvePrincipal(client: HttpClient, type: "group" | "user", name: string, signal: AbortSignal | undefined, cache: PrincipalCache) {
  const folded = name.toLocaleLowerCase("en-US");
  if (type === "group" && Object.prototype.hasOwnProperty.call(automaticGroups, folded)) return automaticGroups[folded];
  const key = `${type}:${folded}`;
  let lookup = cache.get(key);
  if (!lookup) {
    lookup = (async () => {
      try {
        const path = type === "group" ? `/groups/${encodeURIComponent(name)}.json` : `/u/${encodeURIComponent(name)}.json?skip_track_visit=true`;
        const body = await client.get(path, { signal }) as any;
        return (type === "user" ? ownerIdSchema : z.number().int().positive()).parse(body?.[type]?.id);
      } catch (error) {
        if (error instanceof HttpError && error.status === 404) fail("unknown_principal", `Unknown or invisible ${type}: ${name}`, { type, name });
        throw error;
      }
    })();
    cache.set(key, lookup);
  }
  return lookup;
}
export async function resolveAcl(client: HttpClient, entries: AclEntryInput[], signal?: AbortSignal, cache: PrincipalCache = new Map()) {
  const result: Array<{ type: "group" | "user"; id: number; permission: "view" | "edit" | "manage"; name?: string }> = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const id = entry.id ?? await resolvePrincipal(client, entry.type, entry.name!, signal, cache);
    if (entry.type === "user" && id <= 0) fail("invalid_acl_entry", "User ACL entries require a positive user ID; the system user may be an owner but not an ACL entry", { entry: { ...entry, id } });
    if (entry.type === "group" && id === 0) fail("banned_acl_entry", "The everyone group cannot appear in a board ACL with any permission", { entry: { ...entry, id } });
    if (entry.type === "group" && id === 4 && entry.permission !== "view") fail("banned_acl_entry", "The anonymous_users group can only have view permission, not edit or manage", { entry: { ...entry, id } });
    const identity = `${entry.type}:${id}:${entry.permission}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    result.push({ type: entry.type, id, permission: entry.permission, ...(entry.name ? { name: entry.name } : {}) });
  }
  return result;
}
export async function resolveOwners(client: HttpClient, usernames: string[], signal?: AbortSignal, cache: PrincipalCache = new Map()) {
  const result: Array<{ id: number; username: string }> = [];
  for (const username of usernames) {
    const id = await resolvePrincipal(client, "user", username, signal, cache);
    if (!result.some((owner) => owner.id === id)) result.push({ id, username });
  }
  return result;
}
export const wireAcl = (entries: Array<{ type: "group" | "user"; id: number; permission: string }>) => entries.map(({ type, id, permission }) => ({ type, id, permission }));
export function canonicalAcl(entries: Array<{ type: "group" | "user"; id: number; permission: string }>) {
  return [...new Set(entries.filter((entry) => entry.permission !== "owner" && !(entry.type === "group" && entry.id === 1 && entry.permission === "manage")).map((entry) => `${entry.type}:${entry.id}:${entry.permission}`))].sort();
}
