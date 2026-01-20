import { z } from "zod";
import type { RegisterFn } from "../types.js";
import { jsonResponse, jsonError, rateLimit, isZodError, zodError } from "../../util/json_response.js";
import { requireWriteAccess } from "../../util/access.js";

export const registerUpdateUser: RegisterFn = (server, ctx, opts) => {
  if (!opts?.allowWrites) return;

  const schema = z.object({
    username: z.string().min(1).describe("Username of user to update"),
    name: z.string().optional().describe("Display name"),
    bio_raw: z.string().optional().describe("Bio in markdown"),
    location: z.string().optional().describe("Location"),
    website: z.string().url().optional().describe("Website URL"),
    title: z.string().optional().describe("User title"),
    date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Date of birth (YYYY-MM-DD)"),
    locale: z.string().optional().describe("Language preference"),
    profile_background_upload_url: z.string().optional().describe("Profile background image URL"),
    card_background_upload_url: z.string().optional().describe("Card background image URL"),
    upload_id: z.number().int().positive().optional().describe("Avatar upload_id (from discourse_upload_file)"),
  });

  server.registerTool(
    "discourse_update_user",
    {
      title: "Update User",
      description: "Update user profile fields. If upload_id is provided, also sets the user's avatar. Returns JSON with success status and updated user details.",
      inputSchema: schema.shape,
    },
    async (input, _extra) => {
      try {
        const args = schema.parse(input);

        const accessError = requireWriteAccess(ctx.siteState, opts.allowWrites);
        if (accessError) return accessError;

        await rateLimit("user");
        const { client } = ctx.siteState.ensureSelectedSite();

        const { username, upload_id, ...profileFields } = args;

        // Build update payload - only include fields that were provided
        const updatePayload: Record<string, any> = {};
        const updatedFields: string[] = [];

        if (profileFields.name !== undefined) {
          updatePayload.name = profileFields.name;
          updatedFields.push("name");
        }
        if (profileFields.bio_raw !== undefined) {
          updatePayload.bio_raw = profileFields.bio_raw;
          updatedFields.push("bio_raw");
        }
        if (profileFields.location !== undefined) {
          updatePayload.location = profileFields.location;
          updatedFields.push("location");
        }
        if (profileFields.website !== undefined) {
          updatePayload.website = profileFields.website;
          updatedFields.push("website");
        }
        if (profileFields.title !== undefined) {
          updatePayload.title = profileFields.title;
          updatedFields.push("title");
        }
        if (profileFields.date_of_birth !== undefined) {
          updatePayload.date_of_birth = profileFields.date_of_birth;
          updatedFields.push("date_of_birth");
        }
        if (profileFields.locale !== undefined) {
          updatePayload.locale = profileFields.locale;
          updatedFields.push("locale");
        }
        if (profileFields.profile_background_upload_url !== undefined) {
          updatePayload.profile_background_upload_url = profileFields.profile_background_upload_url;
          updatedFields.push("profile_background_upload_url");
        }
        if (profileFields.card_background_upload_url !== undefined) {
          updatePayload.card_background_upload_url = profileFields.card_background_upload_url;
          updatedFields.push("card_background_upload_url");
        }

        // Fail fast if nothing to update
        if (Object.keys(updatePayload).length === 0 && upload_id === undefined) {
          return jsonError("At least one field or upload_id is required");
        }

        let userResponse: any = null;
        let avatarUpdated = false;
        let avatarError: string | undefined;

        // Update profile fields if any were provided
        if (Object.keys(updatePayload).length > 0) {
          userResponse = await client.put(
            `/u/${encodeURIComponent(username)}.json`,
            updatePayload
          ) as any;
        }

        // Set avatar if upload_id was provided
        if (upload_id !== undefined) {
          try {
            await rateLimit("user");
            await client.put(
              `/u/${encodeURIComponent(username)}/preferences/avatar/pick.json`,
              { upload_id, type: "uploaded" }
            );
            avatarUpdated = true;
            updatedFields.push("avatar");
          } catch (e: any) {
            avatarError = e?.message || String(e);
            ctx.logger.error(`Failed to set avatar for user ${username}: ${avatarError}`);
          }
        }

        // Fetch user data if we didn't already get it from update
        if (!userResponse?.user) {
          userResponse = await client.get(`/u/${encodeURIComponent(username)}.json`) as any;
        }

        const user = userResponse?.user || {};

        const result: Record<string, unknown> = {
          success: true,
          username,
          updated_fields: updatedFields,
          avatar_updated: avatarUpdated,
          user: {
            id: user.id,
            username: user.username,
            name: user.name || null,
            bio_raw: user.bio_raw || null,
            location: user.location || null,
            website: user.website || null,
            title: user.title || null,
            trust_level: user.trust_level ?? 0,
            admin: user.admin ?? false,
            moderator: user.moderator ?? false,
          },
        };
        if (avatarError) {
          result.avatar_error = avatarError;
        }
        return jsonResponse(result);
      } catch (e: unknown) {
        if (isZodError(e)) return zodError(e);
        const err = e as any;
        const details: Record<string, unknown> = {};
        if (err?.body) details.body = err.body;
        if (err?.status) details.status = err.status;
        return jsonError(`Failed to update user: ${err?.message || String(e)}`, Object.keys(details).length > 0 ? details : undefined);
      }
    }
  );
};
