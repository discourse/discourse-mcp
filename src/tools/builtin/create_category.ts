import { z } from "zod";
import type { RegisterFn } from "../types.js";
import { jsonResponse, jsonError, rateLimit, isZodError, zodError } from "../../util/json_response.js";

export const registerCreateCategory: RegisterFn = (server, ctx, opts) => {
  if (!opts.allowWrites) return;

  const schema = z.object({
    name: z.string().min(1).max(100),
    color: z.string().regex(/^[0-9a-fA-F]{6}$/).optional(),
    text_color: z.string().regex(/^[0-9a-fA-F]{6}$/).optional(),
    emoji: z.string().optional(),
    icon: z.string().optional(),
    parent_category_id: z.number().int().positive().optional(),
    description: z.string().min(1).max(10000).optional(),
  });

  server.registerTool(
    "discourse_create_category",
    {
      title: "Create Category",
      description: "Create a new category. Returns JSON with id, slug, and name.",
      inputSchema: schema.shape,
    },
    async (input, _extra) => {
      try {
        const { name, color, text_color, emoji, icon, parent_category_id, description } = schema.parse(input);

        await rateLimit("category");

        const { client } = ctx.siteState.ensureSelectedSite();

        const payload: any = { name };
        if (color) payload.color = color;
        if (text_color) payload.text_color = text_color;
        if (parent_category_id) payload.parent_category_id = parent_category_id;
        if (description) payload.description = description;
        if (emoji) payload.emoji = emoji;
        if (icon) payload.icon = icon;
        if (emoji) {
          payload.style_type = 2;
        } else if (icon) {
          payload.style_type = 1;
        }

        const data: any = await client.post(`/categories.json`, payload);
        const category = data?.category || data;

        return jsonResponse({
          id: category?.id,
          slug: category?.slug || (category?.name ? String(category.name).toLowerCase().replace(/\s+/g, "-") : null),
          name: category?.name || name,
        });
      } catch (e: unknown) {
        if (isZodError(e)) return zodError(e);
        const err = e as any;
        return jsonError(`Failed to create category: ${err?.message || String(e)}`);
      }
    }
  );
};
