import { z } from "zod";
import type { RegisterFn } from "../types.js";
import { jsonResponse, jsonError } from "../../util/json_response.js";

export const registerCreateUser: RegisterFn = (server, ctx, opts) => {
  if (!opts?.allowWrites) return;

  const schema = z.object({
    username: z.string().min(1).max(20),
    email: z.string().email(),
    name: z.string().min(1).max(255),
    password: z.string().min(10).max(200),
    active: z.boolean().optional().default(true),
    approved: z.boolean().optional().default(true),
  });

  server.registerTool(
    "discourse_create_user",
    {
      title: "Create User",
      description: "Create a new user account. Returns JSON with success status and user details.",
      inputSchema: schema.shape,
    },
    async (args, _extra: any) => {
      try {
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
          return jsonResponse({
            success: true,
            username: args.username,
            name: args.name,
            email: args.email,
            active: response.active ?? args.active,
            message: response.message || "Account created",
          });
        } else {
          return jsonError(response.message || "Unknown error");
        }
      } catch (e: any) {
        return jsonError(`Failed to create user: ${e?.message || String(e)}`);
      }
    }
  );
};