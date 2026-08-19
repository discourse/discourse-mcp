import { z } from "zod";
import { defineTool } from "../../definition.js";
import { requireActingUserAccess, requireWriteAccess } from "../../../util/access.js";
import { isZodError, jsonError, jsonResponse, rateLimit, zodError } from "../../../util/json_response.js";
import { actingUserHeaders, deduplicateRecipients, emailAddressSchema, groupNameSchema, normalizePostResult, optionalAuthorUsernameSchema, usernameSchema } from "./common.js";

const schema = z.object({
  title: z.string().min(1).max(300),
  raw: z.string().min(1).max(30000),
  usernames: z.array(usernameSchema).optional(),
  group_names: z.array(groupNameSchema).optional(),
  email_addresses: z.array(emailAddressSchema).optional(),
  author_username: optionalAuthorUsernameSchema,
});

export const createPrivateMessageTool = defineTool({
  name: "discourse_create_private_message",
  title: "Create Private Message",
  description: "Create a private message for typed user, group, or email recipients. Unknown emails may create staged users. author_username requires a global API key; the response reports actual attribution.",
  schema,
  availability: "writes_enabled",
  toolsets: ["private_messages"],
  handler: async (input, _extra, ctx, opts) => {
    let suppliedGroupNames: string[] = [];
    try {
      const { title, raw, usernames = [], group_names = [], email_addresses = [], author_username } = schema.parse(input);
      suppliedGroupNames = group_names;
      if (usernames.length + group_names.length + email_addresses.length === 0) {
        return jsonError("Validation failed", { issues: [{ path: "usernames", message: "At least one private-message recipient is required" }] });
      }
      const accessError = requireWriteAccess(ctx.siteState, opts.allowWrites);
      if (accessError) return accessError;
      const actingUserError = requireActingUserAccess(ctx.siteState, author_username);
      if (actingUserError) return actingUserError;
      const recipients = deduplicateRecipients([usernames, group_names, email_addresses]);
      await rateLimit("post");
      const { client } = ctx.siteState.ensureSelectedSite();
      const data = (await client.post("/posts.json", {
        title,
        raw,
        archetype: "private_message",
        target_recipients: recipients.join(","),
      }, { headers: actingUserHeaders(author_username) })) as any;
      const normalized = normalizePostResult(data);
      return jsonResponse({
        ...normalized,
        title: data?.topic_title ?? data?.title ?? title,
        requested_author: author_username ?? null,
        author_applied: author_username ? (normalized.username ? normalized.username.toLowerCase() === author_username.toLowerCase() : null) : null,
      });
    } catch (e: unknown) {
      if (isZodError(e)) return zodError(e);
      const err = e as any;
      return jsonError(
        `Failed to create private message: ${err?.message || String(e)}`,
        suppliedGroupNames.length > 0 ? { group_names: suppliedGroupNames } : undefined,
      );
    }
  },
});
