import { z } from "zod";
import { defineTool } from "../definition.js";
import { jsonResponse, jsonError, rateLimit, isZodError, zodError } from "../../util/json_response.js";
import { requireGlobalApiKeyAccess, requireWriteAccess } from "../../util/access.js";
import { mutationError } from "./common/helpers.js";

const schema = z.object({
  username: z.string().min(1).max(20),
  email: z.string().email(),
  name: z.string().min(1).max(255),
  password: z.string().min(10).max(200),
  active: z.boolean().optional().default(true),
  approved: z.boolean().optional().default(true),
  upload_id: z.number().int().positive().optional().describe("Avatar upload_id (from discourse_upload_file)"),
});

export const createUserTool = defineTool({
  name: "discourse_create_user",
  title: "Create User",
  description: "Create a user through Discourse's signup API using a global admin API key. Reports whether upstream confirmed creation; anti-enumeration responses without user_id remain indeterminate. Optional avatar assignment runs only after confirmed creation.",
  schema,
  availability: "writes_enabled",
  toolsets: ["users"],
  handler: async (input, _extra, ctx, opts) => {
    try {
      const args = schema.parse(input);

      const accessError = requireWriteAccess(ctx.siteState, opts.allowWrites);
      if (accessError) return accessError;
      const apiKeyError = requireGlobalApiKeyAccess(ctx.siteState, "User creation");
      if (apiKeyError) return apiKeyError;

      await rateLimit("user");
      const { client } = ctx.siteState.ensureSelectedSite();

      const userData = {
        username: args.username,
        email: args.email,
        name: args.name,
        password: args.password,
        active: args.active,
        approved: args.approved,
      };

      const response = await client.post("/users.json", userData) as any;

      if (response.success) {
        const userId = typeof response.user_id === "number" ? response.user_id : null;
        const creationConfirmed = userId !== null;
        const createdUsername = creationConfirmed ? (response.username || args.username) : null;
        let avatarUpdated = false;
        let avatarError: string | undefined;

        if (args.upload_id !== undefined && creationConfirmed && createdUsername) {
          try {
            await rateLimit("user");
            await client.put(
              `/u/${encodeURIComponent(createdUsername)}/preferences/avatar/pick.json`,
              { upload_id: args.upload_id, type: "uploaded" },
              { headers: { "Api-Username": createdUsername } },
            );
            avatarUpdated = true;
          } catch (e: any) {
            avatarError = e?.message || String(e);
            ctx.logger.error(`Failed to set avatar for new user ${createdUsername}: ${avatarError}`);
          }
        } else if (args.upload_id !== undefined && !creationConfirmed) {
          avatarError = "Avatar assignment skipped because Discourse did not confirm account creation";
        }

        const result: Record<string, unknown> = {
          request_accepted: true,
          created: creationConfirmed ? true : null,
          user_id: userId,
          username: createdUsername,
          requested_username: args.username,
          name: args.name,
          email: args.email,
          active: response.active ?? null,
          avatar_updated: avatarUpdated,
          message: response.message || "Account request accepted",
        };
        if (!creationConfirmed) {
          result.warning = "Discourse did not return user_id, so account creation is unconfirmed and may be an anti-enumeration response.";
        }
        if (avatarError) result.avatar_error = avatarError;
        return jsonResponse(result);
      } else {
        const details: Record<string, unknown> = {};
        if (response.errors) details.errors = response.errors;
        if (response.values) details.values = response.values;
        return jsonError(response.message || "Unknown error", Object.keys(details).length > 0 ? details : undefined);
      }
    } catch (e: unknown) {
      if (isZodError(e)) return zodError(e);
      return mutationError("Failed to create user", e);
    }
  },
});
