import { z } from "zod";
import { defineTool } from "../../definition.js";
import { isZodError, jsonResponse, rateLimit, zodError } from "../../../util/json_response.js";
import {
  groupError,
  groupIdSchema,
  groupNameSchema,
  optionalString,
  queryString,
  requireGroupRead,
  requireGroupWrite,
} from "./common.js";

const listRequestsSchema = z.object({
  name: groupNameSchema,
  limit: z.number().int().min(1).max(1000).optional(),
  offset: z.number().int().nonnegative().optional(),
  filter: optionalString(z.string().trim().min(1)),
  order: z.literal("requested_at").optional(),
  asc: z.boolean().optional(),
});

export const listGroupMembershipRequestsTool = defineTool({
  name: "discourse_list_group_membership_requests",
  title: "List Group Membership Requests",
  description: "List pending membership requests and reasons for a group the caller can manage, with filtering and pagination.",
  schema: listRequestsSchema,
  availability: "always",
  toolsets: ["groups"],
  handler: async (input, _extra, ctx) => {
    try {
      const { name, ...query } = listRequestsSchema.parse(input);
      const denied = requireGroupRead(ctx.siteState);
      if (denied) return denied;
      const { client } = ctx.siteState.ensureSelectedSite();
      return jsonResponse(await client.get(`/groups/${encodeURIComponent(name)}/members.json${queryString({ ...query, requesters: true })}`));
    } catch (error) {
      if (isZodError(error)) return zodError(error);
      return groupError("list group membership requests", error);
    }
  },
});

const handleSchema = z.object({
  id: groupIdSchema,
  user_id: groupIdSchema,
  action: z.enum(["approve", "deny"]),
});

export const handleGroupMembershipRequestTool = defineTool({
  name: "discourse_handle_group_membership_request",
  title: "Handle Group Membership Request",
  description: "Approve or deny one pending group membership request. Approval adds the requester to the group; denial only removes the request.",
  schema: handleSchema,
  availability: "writes_enabled",
  toolsets: ["groups"],
  handler: async (input, _extra, ctx, opts) => {
    try {
      const { id, user_id, action } = handleSchema.parse(input);
      const denied = requireGroupWrite(ctx.siteState, opts);
      if (denied) return denied;
      await rateLimit("group_membership");
      const { client } = ctx.siteState.ensureSelectedSite();
      return jsonResponse(await client.put(`/groups/${id}/handle_membership_request.json`, {
        user_id,
        ...(action === "approve" ? { accept: true } : {}),
      }));
    } catch (error) {
      if (isZodError(error)) return zodError(error);
      return groupError("handle group membership request", error);
    }
  },
});

const requestSchema = z.object({
  name: groupNameSchema,
  reason: z.string().trim().min(1).max(5000),
});

export const requestGroupMembershipTool = defineTool({
  name: "discourse_request_group_membership",
  title: "Request Group Membership",
  description: "Request membership in a visible group that allows requests, sending the reason to its owners.",
  schema: requestSchema,
  availability: "writes_enabled",
  toolsets: ["groups"],
  handler: async (input, _extra, ctx, opts) => {
    try {
      const { name, reason } = requestSchema.parse(input);
      const denied = requireGroupWrite(ctx.siteState, opts);
      if (denied) return denied;
      await rateLimit("group_membership");
      const { client } = ctx.siteState.ensureSelectedSite();
      return jsonResponse(await client.post(`/groups/${encodeURIComponent(name)}/request_membership.json`, { reason }));
    } catch (error) {
      if (isZodError(error)) return zodError(error);
      return groupError("request group membership", error);
    }
  },
});

const selfServiceSchema = z.object({ id: groupIdSchema });

export const joinGroupTool = defineTool({
  name: "discourse_join_group",
  title: "Join Group",
  description: "Join a visible group that allows public admission as the authenticated user.",
  schema: selfServiceSchema,
  availability: "writes_enabled",
  toolsets: ["groups"],
  handler: async (input, _extra, ctx, opts) => {
    try {
      const { id } = selfServiceSchema.parse(input);
      const denied = requireGroupWrite(ctx.siteState, opts);
      if (denied) return denied;
      await rateLimit("group_membership");
      const { client } = ctx.siteState.ensureSelectedSite();
      return jsonResponse(await client.put(`/groups/${id}/join.json`, {}));
    } catch (error) {
      if (isZodError(error)) return zodError(error);
      return groupError("join group", error);
    }
  },
});

export const leaveGroupTool = defineTool({
  name: "discourse_leave_group",
  title: "Leave Group",
  description: "Leave a group that allows public exit as the authenticated user.",
  schema: selfServiceSchema,
  availability: "writes_enabled",
  toolsets: ["groups"],
  handler: async (input, _extra, ctx, opts) => {
    try {
      const { id } = selfServiceSchema.parse(input);
      const denied = requireGroupWrite(ctx.siteState, opts);
      if (denied) return denied;
      await rateLimit("group_membership");
      const { client } = ctx.siteState.ensureSelectedSite();
      return jsonResponse(await client.delete(`/groups/${id}/leave.json`));
    } catch (error) {
      if (isZodError(error)) return zodError(error);
      return groupError("leave group", error);
    }
  },
});
