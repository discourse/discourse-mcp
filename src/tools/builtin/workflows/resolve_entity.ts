import { z } from "zod";
import { defineTool } from "../../definition.js";
import { jsonResponse, isZodError, zodError } from "../../../util/json_response.js";
import { WORKFLOWS_BASE, requireWorkflowAdmin, workflowError } from "./common.js";
const schema = z.object({ kind: z.enum(["category", "tag", "user", "group", "badge", "data_table", "chat_channel"]), query: z.string().min(1) });
const endpoints = { category: "/categories.json", tag: "/tags.json", user: "/u/search/users.json", group: "/groups.json", badge: "/badges.json", data_table: `${WORKFLOWS_BASE}/data-tables.json`, chat_channel: "/chat/api/channels.json" } as const;
function candidates(kind: keyof typeof endpoints, data: any): any[] {
  if (kind === "category") return data?.category_list?.categories ?? data?.categories ?? [];
  if (kind === "tag") return data?.tags ?? [];
  if (kind === "user") return data?.users ?? [];
  if (kind === "group") return data?.groups ?? [];
  if (kind === "badge") return data?.badges ?? [];
  if (kind === "chat_channel") return data?.channels ?? data?.chat_channels ?? [];
  return data?.data_tables ?? data?.tables ?? [];
}
export const resolveWorkflowEntityTool = defineTool({
  name: "discourse_resolve_workflow_entity", title: "Resolve Workflow Entity", description: "Resolve category, tag, group, user, badge, chat channel, or data-table ids for workflow parameters.",
  schema, availability: "always", toolsets: ["workflows"], handler: async (input: unknown, _extra, ctx) => { try {
    const { kind, query } = schema.parse(input); const denied = requireWorkflowAdmin(ctx.siteState); if (denied) return denied;
    const { client } = ctx.siteState.ensureSelectedSite(); const suffix = kind === "user" ? `?term=${encodeURIComponent(query)}` : "";
    const data = await client.get(`${endpoints[kind]}${suffix}`); const needle = query.toLowerCase();
    const matches = candidates(kind, data).filter((item) => String(item.name ?? item.username ?? item.text ?? item.slug ?? "").toLowerCase().includes(needle)).slice(0, 10)
      .map((item) => ({ id: item.id ?? item.name, name: item.name ?? item.username ?? item.text ?? item.slug, slug: item.slug, username: item.username }));
    return jsonResponse({ kind, matches });
  } catch (e) { if (isZodError(e)) return zodError(e); return workflowError("resolve workflow entity", e); } },
});
