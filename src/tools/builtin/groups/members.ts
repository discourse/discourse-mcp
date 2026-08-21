import { z } from "zod";
import { defineTool } from "../../definition.js";
import { isZodError, jsonResponse, rateLimit, zodError } from "../../../util/json_response.js";
import {
  emailSchema,
  groupError,
  groupIdSchema,
  groupNameSchema,
  optionalString,
  queryString,
  requireGroupWrite,
  usernameSchema,
} from "./common.js";

const listSchema = z.object({
  name: groupNameSchema,
  limit: z.number().int().min(1).max(1000).optional(),
  offset: z.number().int().nonnegative().optional(),
  filter: optionalString(z.string().trim().min(1)),
  order: z.enum(["username", "last_posted_at", "last_seen_at", "added_at"]).optional(),
  asc: z.boolean().optional(),
});

export const listGroupMembersTool = defineTool({
  name: "discourse_list_group_members",
  title: "List Group Members",
  description: "List a group's members and owners with filtering, ordering, and pagination. Visibility is enforced by Discourse.",
  schema: listSchema,
  availability: "always",
  toolsets: ["groups"],
  handler: async (input, _extra, ctx) => {
    try {
      const { name, ...query } = listSchema.parse(input);
      const { client } = ctx.siteState.ensureSelectedSite();
      return jsonResponse(await client.get(`/groups/${encodeURIComponent(name)}/members.json${queryString(query)}`));
    } catch (error) {
      if (isZodError(error)) return zodError(error);
      return groupError("list group members", error);
    }
  },
});

type SelectorKind = "username" | "user_id" | "email";
type MutationKind = "add members" | "remove members" | "add owners" | "remove owners";

const selectors = {
  username: {
    inputKey: "usernames",
    schema: z.array(usernameSchema).min(1).max(1000).describe("Canonical usernames of existing users; do not provide user IDs or email addresses"),
    description: "canonical usernames",
  },
  user_id: {
    inputKey: "user_ids",
    schema: z.array(groupIdSchema).min(1).max(1000).describe("Numeric IDs of existing users; numbers must not be quoted as strings"),
    description: "numeric user IDs",
  },
  email: {
    inputKey: "user_emails",
    schema: z.array(emailSchema).min(1).max(1000).describe("Email addresses that already belong to user accounts; use the invitation tool for unknown addresses"),
    description: "email addresses belonging to existing accounts",
  },
} as const;

function mutationDetails(kind: MutationKind) {
  switch (kind) {
    case "add members":
      return { method: "put" as const, path: (id: number) => `/groups/${id}/members.json`, verb: "Add", noun: "Group Members", options: true };
    case "remove members":
      return { method: "delete" as const, path: (id: number) => `/groups/${id}/members.json`, verb: "Remove", noun: "Group Members", options: false };
    case "add owners":
      return { method: "put" as const, path: (id: number) => `/groups/${id}/owners.json`, verb: "Add", noun: "Group Owners", options: true };
    case "remove owners":
      return { method: "delete" as const, path: (id: number) => `/admin/groups/${id}/owners.json`, verb: "Remove", noun: "Group Owners", options: false };
  }
}

function selectorSuffix(selector: SelectorKind) {
  return selector === "username" ? "username" : selector === "user_id" ? "user_id" : "email";
}

function makeMutationTool(kind: MutationKind, selector: SelectorKind) {
  const selected = selectors[selector];
  const details = mutationDetails(kind);
  const schema = z.object({
    id: groupIdSchema,
    [selected.inputKey]: selected.schema,
    ...(details.options ? { notify_users: z.boolean().optional().describe("Notify users added as members or owners") } : {}),
  }).strict();
  const baseName = kind === "add members" ? "add_group_members"
    : kind === "remove members" ? "remove_group_members"
    : kind === "add owners" ? "add_group_owners"
    : "remove_group_owners";
  const action = `${kind} by ${selector === "email" ? "account email" : selector.replace("_", " ")}`;

  return defineTool({
    name: `discourse_${baseName}_by_${selectorSuffix(selector)}`,
    title: `${details.verb} ${details.noun} by ${selector === "email" ? "Email" : selector === "user_id" ? "User ID" : "Username"}`,
    description: `${details.verb} ${kind.includes("owners") ? "group owners" : "group members"} using ${selected.description}. This tool accepts only this identifier type, avoiding ambiguous selector precedence.`,
    schema,
    availability: "writes_enabled",
    toolsets: ["groups"],
    handler: async (input, _extra, ctx, opts) => {
      try {
        const parsed = schema.parse(input) as Record<string, unknown> & { id: number; notify_users?: boolean };
        const denied = requireGroupWrite(ctx.siteState, opts);
        if (denied) return denied;
        const payload: Record<string, unknown> = {
          [selected.inputKey]: (parsed[selected.inputKey] as Array<string | number>).join(","),
        };
        if (parsed.notify_users !== undefined) payload.notify_users = String(parsed.notify_users);
        await rateLimit("group_membership");
        const { client } = ctx.siteState.ensureSelectedSite();
        const data = details.method === "put"
          ? await client.put(details.path(parsed.id), payload)
          : await client.delete(details.path(parsed.id), payload);
        return jsonResponse(data);
      } catch (error) {
        if (isZodError(error)) return zodError(error);
        return groupError(action, error);
      }
    },
  });
}

export const addGroupMembersByUsernameTool = makeMutationTool("add members", "username");
export const addGroupMembersByUserIdTool = makeMutationTool("add members", "user_id");
export const addGroupMembersByEmailTool = makeMutationTool("add members", "email");

const inviteSchema = z.object({
  id: groupIdSchema,
  emails: z.array(emailSchema).min(1).max(1000).describe("Email addresses to invite to the forum and add to this group after redemption"),
  skip_email: z.boolean().optional().describe("Create invitations without sending invitation email"),
}).strict();

export const inviteGroupMembersByEmailTool = defineTool({
  name: "discourse_invite_group_members_by_email",
  title: "Invite Group Members by Email",
  description: "Add existing accounts immediately when an address matches, and invite unknown addresses to the forum with this group preassigned. Use add_group_members_by_email when every address is known to belong to an account.",
  schema: inviteSchema,
  availability: "writes_enabled",
  toolsets: ["groups"],
  handler: async (input, _extra, ctx, opts) => {
    try {
      const { id, emails, skip_email } = inviteSchema.parse(input);
      const denied = requireGroupWrite(ctx.siteState, opts);
      if (denied) return denied;
      await rateLimit("group_membership");
      const { client } = ctx.siteState.ensureSelectedSite();
      return jsonResponse(await client.put(`/groups/${id}/members.json`, {
        emails: emails.join(","),
        ...(skip_email !== undefined ? { skip_email: String(skip_email) } : {}),
      }));
    } catch (error) {
      if (isZodError(error)) return zodError(error);
      return groupError("invite group members by email", error);
    }
  },
});

export const removeGroupMembersByUsernameTool = makeMutationTool("remove members", "username");
export const removeGroupMembersByUserIdTool = makeMutationTool("remove members", "user_id");
export const removeGroupMembersByEmailTool = makeMutationTool("remove members", "email");
export const addGroupOwnersByUsernameTool = makeMutationTool("add owners", "username");
export const addGroupOwnersByUserIdTool = makeMutationTool("add owners", "user_id");
export const addGroupOwnersByEmailTool = makeMutationTool("add owners", "email");
export const removeGroupOwnersByUsernameTool = makeMutationTool("remove owners", "username");
export const removeGroupOwnersByUserIdTool = makeMutationTool("remove owners", "user_id");
export const removeGroupOwnersByEmailTool = makeMutationTool("remove owners", "email");
