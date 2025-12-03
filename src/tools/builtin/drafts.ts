import { z } from "zod";
import type { RegisterFn } from "../types.js";

/**
 * Discourse Draft Tools
 *
 * Drafts in Discourse use a key-based system:
 * - "new_topic" - Draft for creating a new topic
 * - "topic_<id>" - Draft for replying to topic with ID <id>
 * - "new_private_message" - Draft for a new private message
 *
 * The draft data is stored as a JSON object containing:
 * - reply: The draft text content
 * - title: Topic title (for new topics)
 * - categoryId: Category ID
 * - tags: Array of tag names
 * - action: "createTopic", "reply", "edit", etc.
 *
 * Drafts use a sequence number for optimistic locking. When updating
 * a draft, you should use the sequence returned from listing/getting drafts.
 */

// Rate limiting for draft operations
let lastDraftOp = 0;
async function rateLimitDraftOp() {
  const now = Date.now();
  if (now - lastDraftOp < 500) {
    const wait = 500 - (now - lastDraftOp);
    await new Promise((r) => setTimeout(r, wait));
  }
  lastDraftOp = Date.now();
}

/**
 * List all drafts for the current user
 */
export const registerListDrafts: RegisterFn = (server, ctx, _opts) => {
  const schema = z.object({
    offset: z.number().int().min(0).optional().describe("Pagination offset (default: 0)"),
  });

  server.registerTool(
    "discourse_list_drafts",
    {
      title: "List Drafts",
      description:
        "List all drafts for the current user. Returns draft keys, sequences, and preview content. Use this to find existing drafts before updating them.",
      inputSchema: schema.shape,
    },
    async (input: unknown, _extra: unknown) => {
      const { offset } = schema.parse(input);

      try {
        const { base, client } = ctx.siteState.ensureSelectedSite();
        const params = new URLSearchParams();
        if (typeof offset === "number") params.set("offset", String(offset));

        const url = `/drafts.json${params.toString() ? `?${params}` : ""}`;
        const data = (await client.get(url)) as {
          drafts?: Array<{
            draft_key: string;
            sequence: number;
            data?: string;
            title?: string;
            category_id?: number;
            created_at?: string;
          }>;
        };

        const drafts = data?.drafts || [];

        if (drafts.length === 0) {
          return { content: [{ type: "text", text: "No drafts found." }] };
        }

        const lines = ["# Drafts\n"];
        for (const draft of drafts) {
          lines.push(`## Draft: \`${draft.draft_key}\` (sequence: ${draft.sequence})`);
          if (draft.title) lines.push(`**Title:** ${draft.title}`);
          if (draft.category_id) lines.push(`**Category ID:** ${draft.category_id}`);
          if (draft.created_at) lines.push(`**Created:** ${draft.created_at}`);

          // Parse and show preview of reply content
          if (draft.data) {
            try {
              const parsed = JSON.parse(draft.data);
              if (parsed.reply) {
                const preview = parsed.reply.length > 200 ? parsed.reply.slice(0, 200) + "..." : parsed.reply;
                lines.push(`**Preview:**\n> ${preview.replace(/\n/g, "\n> ")}`);
              }
            } catch {
              // Ignore parse errors
            }
          }
          lines.push("");
        }

        lines.push("\n```json");
        lines.push(JSON.stringify(drafts, null, 2));
        lines.push("```");

        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return { content: [{ type: "text", text: `Failed to list drafts: ${msg}` }], isError: true };
      }
    }
  );
};

/**
 * Get a specific draft by key
 */
export const registerGetDraft: RegisterFn = (server, ctx, _opts) => {
  const schema = z.object({
    draft_key: z
      .string()
      .min(1)
      .max(40)
      .describe('Draft key (e.g., "new_topic", "topic_123", "new_private_message")'),
    sequence: z.number().int().min(0).optional().describe("Expected sequence number (optional)"),
  });

  server.registerTool(
    "discourse_get_draft",
    {
      title: "Get Draft",
      description:
        'Retrieve a specific draft by its key. Common keys: "new_topic" for new topic drafts, "topic_<id>" for reply drafts.',
      inputSchema: schema.shape,
    },
    async (input: unknown, _extra: unknown) => {
      const { draft_key, sequence } = schema.parse(input);

      try {
        const { client } = ctx.siteState.ensureSelectedSite();
        const params = new URLSearchParams();
        if (typeof sequence === "number") params.set("sequence", String(sequence));

        const url = `/drafts/${encodeURIComponent(draft_key)}.json${params.toString() ? `?${params}` : ""}`;
        const data = (await client.get(url)) as {
          draft?: string;
          draft_sequence?: number;
        };

        if (!data?.draft) {
          return { content: [{ type: "text", text: `No draft found for key "${draft_key}".` }] };
        }

        let parsedDraft: Record<string, unknown> = {};
        try {
          parsedDraft = JSON.parse(data.draft);
        } catch {
          parsedDraft = { raw: data.draft };
        }

        const lines = [`# Draft: \`${draft_key}\`\n`];
        lines.push(`**Sequence:** ${data.draft_sequence ?? "unknown"}`);

        if (parsedDraft.title) lines.push(`**Title:** ${parsedDraft.title}`);
        if (parsedDraft.categoryId) lines.push(`**Category ID:** ${parsedDraft.categoryId}`);
        if (parsedDraft.tags && Array.isArray(parsedDraft.tags)) {
          lines.push(`**Tags:** ${(parsedDraft.tags as string[]).join(", ")}`);
        }
        if (parsedDraft.action) lines.push(`**Action:** ${parsedDraft.action}`);

        if (parsedDraft.reply) {
          lines.push(`\n**Content:**\n${parsedDraft.reply}`);
        }

        lines.push("\n```json");
        lines.push(
          JSON.stringify(
            {
              draft_key,
              draft_sequence: data.draft_sequence,
              data: parsedDraft,
            },
            null,
            2
          )
        );
        lines.push("```");

        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return { content: [{ type: "text", text: `Failed to get draft: ${msg}` }], isError: true };
      }
    }
  );
};

/**
 * Create or update a draft
 */
export const registerSaveDraft: RegisterFn = (server, ctx, opts) => {
  if (!opts.allowWrites) return;

  const schema = z.object({
    draft_key: z
      .string()
      .min(1)
      .max(40)
      .describe('Draft key: "new_topic" for new topics, "topic_<id>" for replies (e.g., "topic_123")'),
    reply: z.string().min(1).max(50000).describe("The draft content/body text"),
    title: z.string().min(1).max(300).optional().describe("Topic title (required for new_topic drafts)"),
    category_id: z.number().int().positive().optional().describe("Category ID for the topic"),
    tags: z.array(z.string().min(1).max(100)).max(10).optional().describe("Array of tag names"),
    sequence: z
      .number()
      .int()
      .min(0)
      .default(0)
      .describe("Current sequence number (use 0 for new drafts, or the sequence from get/list for updates)"),
    action: z
      .enum(["createTopic", "reply", "edit", "privateMessage"])
      .optional()
      .describe('Draft action type (defaults based on draft_key: "createTopic" for new_topic, "reply" for topic_*)'),
  });

  server.registerTool(
    "discourse_save_draft",
    {
      title: "Create/Save Draft",
      description:
        "Create a draft topic, create a draft reply, or update an existing draft. Use this when the user wants to draft something without publishing immediately. For new topic drafts, use draft_key='new_topic'. For reply drafts, use draft_key='topic_<id>' (e.g., 'topic_123'). Returns the new sequence number for subsequent updates.",
      inputSchema: schema.shape,
    },
    async (input: unknown, _extra: unknown) => {
      const { draft_key, reply, title, category_id, tags, sequence, action } = schema.parse(input);

      await rateLimitDraftOp();

      try {
        const { base, client } = ctx.siteState.ensureSelectedSite();

        // Build the draft data object
        const draftData: Record<string, unknown> = {
          reply,
        };

        // Determine action based on draft_key if not explicitly provided
        let resolvedAction = action;
        if (!resolvedAction) {
          if (draft_key === "new_topic") {
            resolvedAction = "createTopic";
          } else if (draft_key === "new_private_message") {
            resolvedAction = "privateMessage";
          } else if (draft_key.startsWith("topic_")) {
            resolvedAction = "reply";
          }
        }

        if (resolvedAction) draftData.action = resolvedAction;
        if (title) draftData.title = title;
        if (typeof category_id === "number") draftData.categoryId = category_id;
        if (tags && tags.length > 0) draftData.tags = tags;

        // For reply drafts, extract topic_id
        if (draft_key.startsWith("topic_")) {
          const topicId = parseInt(draft_key.replace("topic_", ""), 10);
          if (!isNaN(topicId)) {
            draftData.topic_id = topicId;
          }
        }

        const payload = {
          draft_key,
          data: JSON.stringify(draftData),
          sequence,
        };

        const result = (await client.post("/drafts.json", payload)) as {
          draft_sequence?: number;
          conflict_user?: { id: number; username?: string };
        };

        if (result.conflict_user) {
          return {
            content: [
              {
                type: "text",
                text: `Draft conflict detected! Another user (ID: ${result.conflict_user.id}) has modified the original content. New sequence: ${result.draft_sequence ?? sequence}`,
              },
            ],
            isError: true,
          };
        }

        const newSequence = result.draft_sequence ?? sequence;
        let successMsg = `Draft saved successfully!\n\n`;
        successMsg += `- **Draft Key:** \`${draft_key}\`\n`;
        successMsg += `- **New Sequence:** ${newSequence}\n`;

        if (draft_key === "new_topic" && title) {
          successMsg += `- **Title:** ${title}\n`;
          successMsg += `\nTo continue editing this draft, use:\n`;
          successMsg += `\`discourse_save_draft(draft_key="new_topic", sequence=${newSequence}, ...)\`\n`;
          successMsg += `\nTo publish this draft as a topic, use:\n`;
          successMsg += `\`discourse_create_topic(title="${title}", raw="...", ...)\``;
        } else if (draft_key.startsWith("topic_")) {
          const topicId = draft_key.replace("topic_", "");
          successMsg += `- **Topic ID:** ${topicId}\n`;
          successMsg += `\nView the topic: ${base}/t/${topicId}\n`;
          successMsg += `\nTo continue editing this draft, use:\n`;
          successMsg += `\`discourse_save_draft(draft_key="${draft_key}", sequence=${newSequence}, ...)\`\n`;
          successMsg += `\nTo publish this draft as a reply, use:\n`;
          successMsg += `\`discourse_create_post(topic_id=${topicId}, raw="...")\``;
        }

        return { content: [{ type: "text", text: successMsg }] };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return { content: [{ type: "text", text: `Failed to save draft: ${msg}` }], isError: true };
      }
    }
  );
};

/**
 * Delete a draft
 */
export const registerDeleteDraft: RegisterFn = (server, ctx, opts) => {
  if (!opts.allowWrites) return;

  const schema = z.object({
    draft_key: z.string().min(1).max(40).describe("Draft key to delete"),
    sequence: z.number().int().min(0).describe("Current sequence number (required for deletion)"),
  });

  server.registerTool(
    "discourse_delete_draft",
    {
      title: "Delete Draft",
      description:
        "Delete a draft by its key. Requires the current sequence number from list/get operations to prevent conflicts.",
      inputSchema: schema.shape,
    },
    async (input: unknown, _extra: unknown) => {
      const { draft_key, sequence } = schema.parse(input);

      await rateLimitDraftOp();

      try {
        const { client } = ctx.siteState.ensureSelectedSite();

        await client.delete(`/drafts/${encodeURIComponent(draft_key)}.json`, { sequence });

        return {
          content: [{ type: "text", text: `Draft "${draft_key}" deleted successfully.` }],
        };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        // Check for sequence mismatch
        if (msg.includes("409") || msg.toLowerCase().includes("conflict") || msg.toLowerCase().includes("sequence")) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to delete draft: Sequence mismatch. The draft may have been modified. Please use discourse_get_draft to get the current sequence and try again.`,
              },
            ],
            isError: true,
          };
        }
        return { content: [{ type: "text", text: `Failed to delete draft: ${msg}` }], isError: true };
      }
    }
  );
};
