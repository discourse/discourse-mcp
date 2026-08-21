import { z } from "zod";
import { HttpError } from "../../../http/client.js";
import { defineTool } from "../../definition.js";
import { requireActingUserAccess, requireWriteAccess } from "../../../util/access.js";
import { isZodError, jsonError, jsonResponse, rateLimit, zodError } from "../../../util/json_response.js";
import { actingUserHeaders, emailAddressSchema, groupNameSchema, normalizeGroup, normalizeUser, optionalAuthorUsernameSchema, usernameSchema } from "./common.js";

const schema = z.object({
  topic_id: z.number().int().positive(),
  username: usernameSchema.optional(),
  group_name: groupNameSchema.optional(),
  email_address: emailAddressSchema.optional(),
  notify_group_members: z.boolean().optional(),
  custom_message: z.string().min(1).max(3000).optional(),
  author_username: optionalAuthorUsernameSchema,
});

export const inviteToPrivateMessageTool = defineTool({
  name: "discourse_invite_to_private_message",
  title: "Invite to Private Message",
  description: "Add a user or group to a private message, or submit an opaque email invitation. Email success does not confirm delivery or participant access. author_username requires a global API key.",
  schema,
  availability: "writes_enabled",
  toolsets: ["private_messages"],
  handler: async (input, _extra, ctx, opts) => {
    let topicId: number | undefined;
    let groupName: string | undefined;
    try {
      const parsed = schema.parse(input);
      const recipients = [parsed.username, parsed.group_name, parsed.email_address].filter((item) => item !== undefined);
      if (recipients.length !== 1) {
        return jsonError("Validation failed", { issues: [{ path: "(root)", message: "Exactly one of username, group_name, or email_address is required" }] });
      }
      if (parsed.notify_group_members !== undefined && !parsed.group_name) {
        return jsonError("Validation failed", { issues: [{ path: "notify_group_members", message: "notify_group_members is only valid with group_name" }] });
      }
      if (parsed.custom_message !== undefined && !parsed.email_address) {
        return jsonError("Validation failed", { issues: [{ path: "custom_message", message: "custom_message is only valid with email_address" }] });
      }
      topicId = parsed.topic_id;
      groupName = parsed.group_name;
      const accessError = requireWriteAccess(ctx.siteState, opts.allowWrites);
      if (accessError) return accessError;
      const actingUserError = requireActingUserAccess(ctx.siteState, parsed.author_username);
      if (actingUserError) return actingUserError;
      await rateLimit("post");
      const { client } = ctx.siteState.ensureSelectedSite();
      const headers = actingUserHeaders(parsed.author_username);

      if (parsed.group_name) {
        const notificationsRequested = parsed.notify_group_members ?? true;
        const data = (await client.post(`/t/${parsed.topic_id}/invite-group.json`, {
          group: parsed.group_name,
          should_notify: notificationsRequested ? "true" : "false",
        }, { headers })) as any;
        const group = data?.group ?? data;
        return jsonResponse({
          topic_id: parsed.topic_id,
          recipient_type: "group",
          status: "added",
          group: normalizeGroup(group),
          notifications_requested: notificationsRequested,
        });
      }

      const payload: Record<string, unknown> = parsed.username
        ? { user: parsed.username }
        : { email: parsed.email_address };
      if (parsed.custom_message !== undefined) payload.custom_message = parsed.custom_message;
      const data = (await client.post(`/t/${parsed.topic_id}/invite.json`, payload, { headers })) as any;
      if (data?.user) {
        return jsonResponse({
          topic_id: parsed.topic_id,
          recipient_type: "user",
          status: "added",
          user: normalizeUser(data.user),
        });
      }
      return jsonResponse({
        topic_id: parsed.topic_id,
        recipient_type: "email",
        status: "submitted",
        participant_added: false,
        outcome_confirmed: false,
      });
    } catch (e: unknown) {
      if (isZodError(e)) return zodError(e);
      const err = e as any;
      const groupHint = groupName && e instanceof HttpError && e.status === 404
        ? ` Use the canonical exact-case group name (${groupName}).`
        : "";
      return jsonError(`Failed to invite participant to private message ${topicId ?? (input as any)?.topic_id}: ${err?.message || String(e)}${groupHint}`);
    }
  },
});
