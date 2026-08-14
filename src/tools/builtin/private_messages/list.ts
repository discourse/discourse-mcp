import { z } from "zod";
import { defineTool } from "../../definition.js";
import { requireAuthenticatedAccess } from "../../../util/access.js";
import { isZodError, jsonError, jsonResponse, paginatedResponse, zodError } from "../../../util/json_response.js";
import { groupNameSchema, normalizeRecentParticipants, resolveCurrentUsername, usernameSchema } from "./common.js";

const mailboxSchema = z.enum(["inbox", "sent", "archive", "unread", "new"]);

const schema = z.object({
  username: usernameSchema.optional(),
  mailbox: mailboxSchema.optional(),
  group_name: groupNameSchema.optional(),
  page: z.number().int().nonnegative().optional(),
  per_page: z.number().int().min(1).max(100).optional(),
});

function routeFor(username: string, mailbox: z.infer<typeof mailboxSchema>, groupName?: string): string {
  const user = encodeURIComponent(username);
  if (groupName) {
    const group = encodeURIComponent(groupName);
    const suffix = mailbox === "inbox" ? "" : `/${mailbox}`;
    return `/topics/private-messages-group/${user}/${group}${suffix}.json`;
  }
  const prefix = mailbox === "inbox" ? "private-messages" : `private-messages-${mailbox}`;
  return `/topics/${prefix}/${user}.json`;
}

export const listPrivateMessagesTool = defineTool({
  name: "discourse_list_private_messages",
  title: "List Private Messages",
  description: "List authenticated personal or group private-message mailboxes. Returns normalized JSON messages and pagination metadata.",
  schema,
  availability: "always",
  toolsets: ["private_messages"],
  handler: async (input, _extra, ctx, _opts) => {
    try {
      const { username: requestedUsername, mailbox = "inbox", group_name, page = 0, per_page = 30 } = schema.parse(input);
      if (group_name && mailbox === "sent") {
        return jsonError("Validation failed", { issues: [{ path: "mailbox", message: "Group private-message mailboxes do not support sent" }] });
      }
      const accessError = requireAuthenticatedAccess(ctx.siteState);
      if (accessError) return accessError;
      const { client } = ctx.siteState.ensureSelectedSite();
      const username = requestedUsername ?? await resolveCurrentUsername(client);
      const params = new URLSearchParams({ page: String(page), per_page: String(per_page) });
      const data = (await client.get(`${routeFor(username, mailbox, group_name)}?${params}`)) as any;
      const topics = Array.isArray(data?.topic_list?.topics) ? data.topic_list.topics : [];
      const messages = topics.map((topic: any) => ({
        topic_id: topic?.id,
        slug: topic?.slug || String(topic?.id ?? ""),
        title: topic?.title || "",
        posts_count: topic?.posts_count ?? 0,
        reply_count: topic?.reply_count ?? 0,
        created_at: topic?.created_at ?? null,
        last_posted_at: topic?.last_posted_at ?? null,
        bumped_at: topic?.bumped_at ?? null,
        last_read_post_number: topic?.last_read_post_number ?? null,
        unread_posts: topic?.unread_posts ?? 0,
        unseen: topic?.unseen ?? false,
        topic_archived: topic?.archived ?? false,
        message_archived: topic?.message_archived ?? null,
        notification_level: topic?.notification_level ?? null,
        recent_participants: normalizeRecentParticipants(topic?.participants),
      }));
      return jsonResponse({
        mailbox,
        username,
        group_name: group_name ?? null,
        ...paginatedResponse("messages", messages, { page, per_page, has_more: Boolean(data?.topic_list?.more_topics_url) }),
      });
    } catch (e: unknown) {
      if (isZodError(e)) return zodError(e);
      const err = e as any;
      return jsonError(`Failed to list private messages: ${err?.message || String(e)}`);
    }
  },
});
