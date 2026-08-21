import { z } from "zod";
import { defineTool } from "../../definition.js";
import { isZodError, jsonError, structuredJsonResponse, zodError } from "../../../util/json_response.js";
import { readAnnotations } from "../common/helpers.js";
import {
  getTagGroup,
  listTagGroups,
  normalizeTag,
  requireTagGroupRead,
  tagGroupError,
} from "./common.js";
import {
  listTagGroupsOutputSchema,
  searchTagGroupsInputSchema,
  searchTagGroupsOutputSchema,
  tagGroupIdSchema,
  tagGroupOutputSchema,
} from "./schemas.js";

export const searchTagGroupsTool = defineTool({
  name: "discourse_search_tag_groups",
  title: "Search Tag Groups",
  description: "Public visibility-filtered tag-group search. q and names combine with AND semantics; upstream treats % and _ in q as SQL LIKE wildcards. Results intentionally omit group IDs, parent tags, and permissions and are not authoritative staff inventory. Exact case-insensitive group name is the supported correlation key. Always sends an explicit limit and reports possible truncation.",
  schema: searchTagGroupsInputSchema,
  outputSchema: searchTagGroupsOutputSchema,
  availability: "always",
  toolsets: ["tag_groups"],
  annotations: readAnnotations(),
  handler: async (input, extra, ctx) => {
    try {
      const { q, names, limit } = searchTagGroupsInputSchema.parse(input);
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      for (const name of names ?? []) params.append("names[]", name);
      params.set("limit", String(limit));
      const { client } = ctx.siteState.ensureSelectedSite();
      const body = await client.get(`/tag_groups/filter/search.json?${params.toString()}`, { signal: extra.signal }) as any;
      if (!Array.isArray(body?.results)) {
        return jsonError("Failed to search tag groups: malformed upstream response", { code: "malformed_upstream_response" });
      }
      const results = body.results.map((raw: any) => ({
        name: raw?.name,
        tags: Array.isArray(raw?.tags) ? raw.tags.map(normalizeTag) : raw?.tags,
      }));
      const normalized = searchTagGroupsOutputSchema.parse({
        results,
        meta: { limit, returned: results.length, truncated: results.length === limit },
      });
      return structuredJsonResponse(normalized);
    } catch (error) {
      if (isZodError(error)) return zodError(error);
      return tagGroupError("Failed to search tag groups", error);
    }
  },
});

export const listTagGroupsTool = defineTool({
  name: "discourse_list_tag_groups",
  title: "List Tag Groups",
  description: "Authoritative unpaginated tag-group inventory ordered by name. Requires a locally configured API credential and upstream staff authority; Discourse returns a privacy-preserving 404 to non-staff. Staff reads can work when tagging is disabled. Returns canonical tags, parent, one-per-topic, numeric permissions (1=full, 3=readonly; group 0=everyone), and optimistic state hashes.",
  schema: z.object({}).strict(),
  outputSchema: listTagGroupsOutputSchema,
  availability: "always",
  toolsets: ["tag_groups"],
  annotations: readAnnotations(),
  handler: async (_input, extra, ctx) => {
    const denied = requireTagGroupRead(ctx.siteState);
    if (denied) return denied;
    try {
      const { client } = ctx.siteState.ensureSelectedSite();
      const normalized = listTagGroupsOutputSchema.parse({
        tag_groups: await listTagGroups(client, extra.signal),
      });
      return structuredJsonResponse(normalized);
    } catch (error) {
      if (isZodError(error)) return jsonError("Failed to list tag groups: malformed upstream response", { code: "malformed_upstream_response" });
      return tagGroupError("Failed to list tag groups", error);
    }
  },
});

const getInputSchema = z.object({ id: tagGroupIdSchema }).strict();

export const getTagGroupTool = defineTool({
  name: "discourse_get_tag_group",
  title: "Get Tag Group",
  description: "Get authoritative tag-group state by ID. Requires a locally configured API credential and upstream staff authority. The deterministic state_hash is an MCP optimistic precondition, not an upstream atomic lock; a race remains possible after preflight.",
  schema: getInputSchema,
  outputSchema: tagGroupOutputSchema,
  availability: "always",
  toolsets: ["tag_groups"],
  annotations: readAnnotations(),
  handler: async (input, extra, ctx) => {
    const denied = requireTagGroupRead(ctx.siteState);
    if (denied) return denied;
    try {
      const { id } = getInputSchema.parse(input);
      const { client } = ctx.siteState.ensureSelectedSite();
      const normalized = tagGroupOutputSchema.parse({ tag_group: await getTagGroup(client, id, extra.signal) });
      return structuredJsonResponse(normalized);
    } catch (error) {
      if (isZodError(error)) return zodError(error);
      return tagGroupError("Failed to get tag group", error);
    }
  },
});
