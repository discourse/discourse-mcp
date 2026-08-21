import { z } from "zod";
import { defineTool } from "../../definition.js";
import { isZodError, jsonError, jsonResponse, rateLimit, structuredJsonResponse, zodError } from "../../../util/json_response.js";
import { fetchAllGroups } from "../../../site/directories.js";
import { readAnnotations } from "../common/helpers.js";
import { groupDirectoryOutputSchema, groupRecordSchema } from "../common/directory_schemas.js";
import {
  accessLevelSchema,
  groupError,
  groupIdSchema,
  groupNameSchema,
  notificationLevelSchema,
  optionalString,
  queryString,
  requireGroupAdminWrite,
  requireGroupWrite,
  usernameSchema,
} from "./common.js";

const GROUP_DIRECTORY_PAGE_SIZE = 36; // Current non-mobile server page size; MCP uses a desktop User-Agent.

const listSchema = z.object({
  page: z.number().int().nonnegative().optional(),
  order: z.enum(["name", "user_count"]).optional(),
  asc: z.boolean().optional(),
  filter: optionalString(z.string().trim().min(1)),
  username: optionalString(usernameSchema),
  type: z.enum(["my", "owner", "public", "close", "automatic", "non_automatic"]).optional(),
}).strict();

export const listGroupsTool = defineTool({
  name: "discourse_list_groups",
  title: "List Groups",
  description: "List visible groups. Empty input exhaustively traverses the bounded directory; any explicit page or filter field preserves the existing single-page query behavior. Both modes return one structured envelope with truthful completion metadata and JSON text fallback. Opt in with the groups toolset.",
  schema: listSchema,
  outputSchema: groupDirectoryOutputSchema,
  availability: "always",
  toolsets: ["groups"],
  annotations: readAnnotations(),
  handler: async (input, extra, ctx) => {
    try {
      // Presence is checked before parsing so explicit false/zero values select
      // compatibility mode while unknown keys still fail strict validation.
      const singlePage = Object.keys(input).length > 0;
      const values = listSchema.parse(input);
      const { client } = ctx.siteState.ensureSelectedSite();

      if (!singlePage) {
        const result = await fetchAllGroups(client, { signal: extra.signal });
        if (result.meta.truncated_reason === "upstream_error" && result.meta.error?.startsWith("Malformed")) {
          return jsonError("Failed to list groups: malformed upstream group record", {
            code: "malformed_upstream_response",
          });
        }
        return structuredJsonResponse(groupDirectoryOutputSchema.parse(result));
      }

      const raw = await client.get(`/groups.json${queryString(values)}`, { signal: extra.signal }) as any;
      const parsedGroups = z.array(groupRecordSchema).safeParse(raw?.groups);
      if (!parsedGroups.success) {
        return jsonError("Failed to list groups: malformed upstream group record", {
          code: "malformed_upstream_response",
        });
      }
      const reportedTotal = Number.isInteger(raw?.total_rows_groups) && raw.total_rows_groups >= 0
        ? raw.total_rows_groups as number
        : null;
      const loadMore = typeof raw?.load_more_groups === "string" ? raw.load_more_groups : null;
      const page = values.page ?? 0;
      const hasMore = reportedTotal !== null
        ? page * GROUP_DIRECTORY_PAGE_SIZE + parsedGroups.data.length < reportedTotal
        : parsedGroups.data.length > 0 && Boolean(loadMore);
      const result = groupDirectoryOutputSchema.parse({
        groups: parsedGroups.data,
        meta: {
          total: parsedGroups.data.length,
          reported_total: reportedTotal,
          pages_fetched: 1,
          complete: false,
          has_more: hasMore,
        },
        ...(raw?.extras !== undefined ? { extras: raw.extras } : {}),
        ...(reportedTotal !== null ? { total_rows_groups: reportedTotal } : {}),
        ...(raw?.load_more_groups !== undefined ? { load_more_groups: loadMore } : {}),
      });
      return structuredJsonResponse(result);
    } catch (error) {
      if (isZodError(error)) return zodError(error);
      return groupError("list groups", error);
    }
  },
});

const getSchema = z.object({
  id: groupIdSchema.optional(),
  name: optionalString(groupNameSchema),
});

export const getGroupTool = defineTool({
  name: "discourse_get_group",
  title: "Get Group",
  description: "Get complete visible group details by numeric ID or name, including caller capabilities and group settings.",
  schema: getSchema,
  availability: "always",
  toolsets: ["groups"],
  handler: async (input, _extra, ctx) => {
    try {
      const { id, name } = getSchema.parse(input);
      if ((id === undefined) === (name === undefined)) {
        return groupError("get group", new Error("Provide exactly one of id or name"));
      }
      const path = id !== undefined ? `/groups/by-id/${id}.json` : `/groups/${encodeURIComponent(name!)}.json`;
      const { client } = ctx.siteState.ensureSelectedSite();
      return jsonResponse(await client.get(path));
    } catch (error) {
      if (isZodError(error)) return zodError(error);
      return groupError("get group", error);
    }
  },
});

const groupSettingsShape = {
  mentionable_level: accessLevelSchema.optional(),
  messageable_level: accessLevelSchema.optional(),
  visibility_level: accessLevelSchema.optional(),
  members_visibility_level: accessLevelSchema.optional(),
  automatic_membership_email_domains: z.string().optional(),
  title: z.string().nullable().optional(),
  primary_group: z.boolean().optional(),
  grant_trust_level: z.number().int().min(0).max(4).nullable().optional(),
  incoming_email: z.string().nullable().optional(),
  flair_icon: z.string().nullable().optional(),
  flair_upload_id: groupIdSchema.nullable().optional(),
  flair_bg_color: z.string().nullable().optional(),
  flair_color: z.string().nullable().optional(),
  bio_raw: z.string().max(30000).nullable().optional(),
  public_admission: z.boolean().optional(),
  public_exit: z.boolean().optional(),
  allow_membership_requests: z.boolean().optional(),
  full_name: z.string().nullable().optional(),
  default_notification_level: notificationLevelSchema.optional(),
  membership_request_template: z.string().max(5000).nullable().optional(),
  publish_read_state: z.boolean().optional(),
  associated_group_ids: z.array(groupIdSchema).optional(),
  custom_fields: z.record(z.unknown()).optional(),
};

const createSchema = z.object({
  name: groupNameSchema,
  ...groupSettingsShape,
  owner_usernames: z.array(usernameSchema).max(1000).optional(),
  usernames: z.array(usernameSchema).max(1000).optional(),
  plugin_fields: z.record(z.unknown()).optional(),
});

export const createGroupTool = defineTool({
  name: "discourse_create_group",
  title: "Create Group",
  description: "Create a custom group with complete core settings, initial members and owners, custom fields, associations, and optional plugin fields. Requires staff group-creation permission.",
  schema: createSchema,
  availability: "writes_enabled",
  toolsets: ["groups"],
  handler: async (input, _extra, ctx, opts) => {
    try {
      const parsed = createSchema.parse(input);
      const denied = requireGroupAdminWrite(ctx.siteState, opts);
      if (denied) return denied;
      const { owner_usernames, usernames, plugin_fields, ...settings } = parsed;
      const group: Record<string, unknown> = { ...settings, ...plugin_fields };
      if (owner_usernames !== undefined) group.owner_usernames = owner_usernames.join(",");
      if (usernames !== undefined) group.usernames = usernames.join(",");
      await rateLimit("group");
      const { client } = ctx.siteState.ensureSelectedSite();
      return jsonResponse(await client.post("/admin/groups.json", { group }));
    } catch (error) {
      if (isZodError(error)) return zodError(error);
      return groupError("create group", error);
    }
  },
});

const updateSchema = z.object({
  id: groupIdSchema,
  name: groupNameSchema.optional(),
  ...groupSettingsShape,
  muted_category_ids: z.array(groupIdSchema).optional(),
  regular_category_ids: z.array(groupIdSchema).optional(),
  tracking_category_ids: z.array(groupIdSchema).optional(),
  watching_category_ids: z.array(groupIdSchema).optional(),
  watching_first_post_category_ids: z.array(groupIdSchema).optional(),
  muted_tags: z.array(z.string()).optional(),
  regular_tags: z.array(z.string()).optional(),
  tracking_tags: z.array(z.string()).optional(),
  watching_tags: z.array(z.string()).optional(),
  watching_first_post_tags: z.array(z.string()).optional(),
  smtp_server: z.string().nullable().optional(),
  smtp_port: z.number().int().positive().nullable().optional(),
  smtp_ssl_mode: z.number().int().nonnegative().optional(),
  smtp_enabled: z.boolean().optional(),
  email_username: z.string().nullable().optional(),
  email_password: z.string().nullable().optional(),
  email_from_alias: z.string().nullable().optional(),
  allow_unknown_sender_topic_replies: z.boolean().optional(),
  update_existing_users: z.boolean().optional(),
  plugin_fields: z.record(z.unknown()).optional(),
});

export const updateGroupTool = defineTool({
  name: "discourse_update_group",
  title: "Update Group",
  description: "Update all core group profile, visibility, admission, notification-default, association, email, SMTP, custom, and plugin settings supported by the caller and group type.",
  schema: updateSchema,
  availability: "writes_enabled",
  toolsets: ["groups"],
  handler: async (input, _extra, ctx, opts) => {
    try {
      const parsed = updateSchema.parse(input);
      const denied = requireGroupWrite(ctx.siteState, opts);
      if (denied) return denied;
      const { id, update_existing_users, plugin_fields, ...settings } = parsed;
      if (Object.keys(settings).length === 0 && !plugin_fields) return groupError("update group", new Error("Provide at least one setting to update"));
      await rateLimit("group");
      const { client } = ctx.siteState.ensureSelectedSite();
      return jsonResponse(await client.put(`/groups/${id}.json`, {
        group: { ...settings, ...plugin_fields },
        ...(update_existing_users !== undefined ? { update_existing_users: String(update_existing_users) } : {}),
      }));
    } catch (error) {
      if (isZodError(error)) return zodError(error);
      return groupError("update group", error);
    }
  },
});

const deleteSchema = z.object({ id: groupIdSchema });

export const deleteGroupTool = defineTool({
  name: "discourse_delete_group",
  title: "Delete Group",
  description: "Permanently delete a custom group. Automatic groups cannot be deleted. Requires staff access.",
  schema: deleteSchema,
  availability: "writes_enabled",
  toolsets: ["groups"],
  handler: async (input, _extra, ctx, opts) => {
    try {
      const { id } = deleteSchema.parse(input);
      const denied = requireGroupAdminWrite(ctx.siteState, opts);
      if (denied) return denied;
      await rateLimit("group");
      const { client } = ctx.siteState.ensureSelectedSite();
      return jsonResponse(await client.delete(`/admin/groups/${id}.json`));
    } catch (error) {
      if (isZodError(error)) return zodError(error);
      return groupError("delete group", error);
    }
  },
});
