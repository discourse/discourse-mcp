import { z } from "zod";
import type { RegisterFn } from "../types.js";
import { jsonResponse, jsonError, rateLimit, isZodError, zodError } from "../../util/json_response.js";

export const registerUpdateTopic: RegisterFn = (server, ctx, opts) => {
  if (!opts?.allowWrites) return;

  const schema = z.object({
    topic_id: z.number().int().positive().describe("Topic ID to update"),
    title: z.string().min(1).max(300).optional().describe("New title"),
    category_id: z.number().int().positive().optional().describe("Move to category"),
    tags: z.array(z.string().min(1).max(100)).max(10).optional().describe("Replace all tags"),
    featured_link: z.string().url().optional().describe("Featured link URL"),
    original_title: z.string().optional().describe("For conflict detection - expected current title"),
    original_tags: z.array(z.string()).optional().describe("For conflict detection - expected current tags"),
  });

  server.registerTool(
    "discourse_update_topic",
    {
      title: "Update Topic",
      description: "Update an existing topic (title, category, tags, featured_link). Returns JSON with updated topic details.",
      inputSchema: schema.shape,
    },
    async (args, _extra) => {
      try {
        const { topic_id, title, category_id, tags, featured_link, original_title, original_tags } = schema.parse(args);

        // Fail fast if no updatable fields provided
        if (title === undefined && category_id === undefined && tags === undefined && featured_link === undefined) {
          return jsonError("At least one of title, category_id, tags, or featured_link is required");
        }

        await rateLimit("topic");

        const { client } = ctx.siteState.ensureSelectedSite();

        // Fetch current topic state for conflict detection
        if (original_title !== undefined || original_tags !== undefined) {
          const currentTopic = (await client.get(`/t/${encodeURIComponent(String(topic_id))}.json`)) as any;

          if (original_title !== undefined && currentTopic?.title !== original_title) {
            return jsonError("Conflict: topic was modified since last read", {
              hint: "Re-read the topic to get current state before updating",
              expected_title: original_title,
              actual_title: currentTopic?.title,
            });
          }

          if (original_tags !== undefined) {
            const currentTags = Array.isArray(currentTopic?.tags) ? currentTopic.tags.sort() : [];
            const expectedTags = [...original_tags].sort();
            if (JSON.stringify(currentTags) !== JSON.stringify(expectedTags)) {
              return jsonError("Conflict: topic was modified since last read", {
                hint: "Re-read the topic to get current state before updating",
                expected_tags: original_tags,
                actual_tags: currentTopic?.tags || [],
              });
            }
          }
        }

        // Build update payload - only include fields that were provided
        const payload: Record<string, any> = {};
        const updatedFields: string[] = [];

        if (title !== undefined) {
          payload.title = title;
          updatedFields.push("title");
        }
        if (category_id !== undefined) {
          payload.category_id = category_id;
          updatedFields.push("category_id");
        }
        if (tags !== undefined) {
          payload.tags = tags;
          updatedFields.push("tags");
        }
        if (featured_link !== undefined) {
          payload.featured_link = featured_link;
          updatedFields.push("featured_link");
        }

        const data = (await client.put(
          `/t/-/${encodeURIComponent(String(topic_id))}.json`,
          payload
        )) as any;

        const topic = data?.basic_topic || data;

        return jsonResponse({
          success: true,
          topic_id,
          updated_fields: updatedFields,
          topic: {
            id: topic.id ?? topic_id,
            title: topic.title ?? title,
            slug: topic.slug ?? null,
            category_id: topic.category_id ?? category_id ?? null,
            tags: Array.isArray(topic.tags) ? topic.tags : (tags ?? []),
            featured_link: topic.featured_link ?? featured_link ?? null,
          },
        });
      } catch (e: unknown) {
        if (isZodError(e)) return zodError(e);
        const err = e as any;
        const status = err?.status || err?.response?.status;
        const body = err?.body || err?.response?.body;

        if (status === 403) {
          return jsonError("Permission denied: cannot update this topic", { status });
        }

        if (status === 409) {
          return jsonError("Conflict: topic was modified since last read", {
            hint: "Re-read the topic to get current state before updating",
            status,
          });
        }

        if (status === 422) {
          const errors = body?.errors || err?.message;
          return jsonError(`Validation failed: ${Array.isArray(errors) ? errors.join(", ") : errors}`, {
            status,
            body,
          });
        }

        const details: Record<string, unknown> = {};
        if (status) details.status = status;
        if (body) details.body = body;
        return jsonError(`Failed to update topic: ${err?.message || String(e)}`, Object.keys(details).length > 0 ? details : undefined);
      }
    }
  );
};
