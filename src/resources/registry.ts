/**
 * MCP Resource Registry
 * 
 * Registers URI-addressable resources for static/semi-static read-only data.
 * Resources use the discourse:// custom URI scheme.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SiteState } from "../site/state.js";
import type { Logger } from "../util/logger.js";
import {
  paginatedResponse,
  transformCategory,
  transformGroup,
  transformTag,
  transformChatChannel,
  transformUserChatChannel,
  transformDraft,
  type LeanGroup,
  type LeanTag,
  type LeanChatChannel,
  type LeanUserChatChannel,
  type LeanDraft,
} from "../util/json_response.js";
import {
  registerExplorerSchemaResource,
  registerExplorerQueriesResource,
} from "./data_explorer.js";
import { registerAiCustomToolsAuthoringGuideResource } from "./ai_custom_tools.js";
import type { BuiltinToolsetMembership } from "../tools/toolsets.js";
import { fetchAllCategories, fetchAllGroups } from "../site/directories.js";

/** Narrowed interface for resource registration - only requires resource method */
export type ResourceRegistrar = Pick<McpServer, "resource">;

export interface ResourceContext {
  siteState: SiteState;
  logger: Logger;
}

/**
 * Registers all MCP resources.
 * Resources are read-only, URI-addressable data endpoints.
 */
export interface ResourceRegistrationOptions {
  toolsets?: BuiltinToolsetMembership;
}

export function registerAllResources(
  server: ResourceRegistrar,
  ctx: ResourceContext,
  opts: ResourceRegistrationOptions = {},
): void {
  registerCategoriesResource(server, ctx);
  registerTagsResource(server, ctx);
  registerGroupsResource(server, ctx);
  registerChatChannelsResource(server, ctx);
  registerUserChatChannelsResource(server, ctx);
  registerUserDraftsResource(server, ctx);

  // Data Explorer resources are always registered; access is checked at call time
  registerExplorerSchemaResource(server, ctx);
  registerExplorerQueriesResource(server, ctx);

  if (opts.toolsets?.includes("ai_custom_tools")) {
    registerAiCustomToolsAuthoringGuideResource(server, ctx);
  }
}

/**
 * discourse://site/categories
 * Lists all categories with hierarchy and permissions.
 */
function registerCategoriesResource(server: ResourceRegistrar, ctx: ResourceContext): void {
  server.resource(
    "site_categories",
    "discourse://site/categories",
    { description: "DEPRECATED compatibility resource. Use discourse_list_categories (opt-in administration toolset) for the canonical structured directory. Lists categories with hierarchy (parent_category_id; legacy pid), optional permissions (perms), counts, and truthful completeness metadata." },
    async (uri) => {
      try {
        const { client } = ctx.siteState.ensureSelectedSite();
        const directory = await fetchAllCategories(client, {
          authenticated: ctx.siteState.getAuthType() !== "none",
        });
        if (directory.meta.truncated_reason === "upstream_error" && directory.meta.error?.startsWith("Malformed")) {
          throw new Error(directory.meta.error);
        }
        const byId = new Map(directory.categories.map((category) => [category.id, category]));

        // Category search does not carry group_permissions. Enrich in bounded
        // chunks to preserve the compatibility resource without oversized URLs.
        const ids = directory.categories.map((category) => category.id);
        for (let offset = 0; offset < ids.length; offset += 50) {
          const chunk = ids.slice(offset, offset + 50);
          const idsParams = chunk.map((id) => `ids[]=${encodeURIComponent(id)}`).join("&");
          try {
            const found = await client.getCached(
              `/categories/find.json?include_permissions=true&${idsParams}`,
              30_000,
            ) as any;
            for (const raw of Array.isArray(found?.categories) ? found.categories : []) {
              const category = transformCategory(raw);
              const existing = byId.get(category.id);
              byId.set(category.id, existing
                ? { ...existing, ...(category.perms ? { perms: category.perms } : {}) }
                : category);
            }
          } catch (error) {
            ctx.logger.error(`Failed to enrich category permissions: ${error instanceof Error ? error.message : String(error)}`);
          }
        }

        const response = {
          categories: directory.categories.map((category) => byId.get(category.id) ?? category),
          meta: directory.meta,
        };
        return {
          contents: [{
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(response),
          }],
        };
      } catch (error) {
        ctx.logger.error(`Failed to fetch categories: ${error instanceof Error ? error.message : String(error)}`);
        return {
          contents: [{
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify({
              error: "Failed to fetch category directory",
              code: "upstream_error",
            }),
          }],
        };
      }
    }
  );
}

/**
 * discourse://site/tags
 * Lists all tags with usage counts.
 */
function registerTagsResource(server: ResourceRegistrar, ctx: ResourceContext): void {
  server.resource(
    "site_tags",
    "discourse://site/tags",
    { description: "List all tags with usage counts. Returns empty if tags are disabled." },
    async (uri) => {
      const { client } = ctx.siteState.ensureSelectedSite();

      try {
        const data = (await client.get("/tags.json")) as any;
        const rawTags: any[] = data?.tags || [];

        const tags: LeanTag[] = rawTags.map(transformTag);

        const response = paginatedResponse("tags", tags, {
          total: tags.length,
        });

        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify(response),
            },
          ],
        };
      } catch {
        // Tags may be disabled
        const response = paginatedResponse("tags", [], { total: 0 });
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify(response),
            },
          ],
        };
      }
    }
  );
}

/**
 * discourse://site/groups
 * Lists all groups for gid -> name resolution.
 */
function registerGroupsResource(server: ResourceRegistrar, ctx: ResourceContext): void {
  server.resource(
    "site_groups",
    "discourse://site/groups",
    { description: "DEPRECATED compatibility resource. Use discourse_list_groups (opt-in groups toolset) for the canonical structured directory. Lists all visible groups with visibility and interaction levels plus truthful completeness metadata." },
    async (uri) => {
      try {
        const { client } = ctx.siteState.ensureSelectedSite();
        const directory = await fetchAllGroups(client);
        if (directory.meta.truncated_reason === "upstream_error" && directory.meta.error?.startsWith("Malformed")) {
          throw new Error(directory.meta.error);
        }
        const groups: LeanGroup[] = directory.groups.map(transformGroup);
        const response = {
          groups,
          meta: directory.meta,
          ...(directory.extras !== undefined ? { extras: directory.extras } : {}),
          ...(directory.total_rows_groups !== undefined ? { total_rows_groups: directory.total_rows_groups } : {}),
          ...(directory.load_more_groups !== undefined ? { load_more_groups: directory.load_more_groups } : {}),
        };
        return {
          contents: [{
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(response),
          }],
        };
      } catch (error) {
        ctx.logger.error(`Failed to fetch groups: ${error instanceof Error ? error.message : String(error)}`);
        return {
          contents: [{
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify({
              error: "Failed to fetch group directory",
              code: "upstream_error",
            }),
          }],
        };
      }
    }
  );
}

/**
 * discourse://chat/channels
 * Lists all public chat channels.
 */
function registerChatChannelsResource(server: ResourceRegistrar, ctx: ResourceContext): void {
  server.resource(
    "chat_channels",
    "discourse://chat/channels",
    { description: "List all public chat channels with id, title, slug, status, members_count, and description." },
    async (uri) => {
      const { client } = ctx.siteState.ensureSelectedSite();

      try {
        const data = (await client.get("/chat/api/channels")) as any;
        const rawChannels: any[] = data?.channels || [];

        const channels: LeanChatChannel[] = rawChannels.map(transformChatChannel);

        const response = paginatedResponse("channels", channels, {
          total: channels.length,
        });

        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify(response),
            },
          ],
        };
      } catch (e: any) {
        ctx.logger.error(`Failed to fetch chat channels: ${e?.message || String(e)}`);
        const response = paginatedResponse("channels", [], { total: 0 });
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify(response),
            },
          ],
        };
      }
    }
  );
}

/**
 * discourse://user/chat-channels
 * Lists all chat channels for the authenticated user (public + DMs).
 */
function registerUserChatChannelsResource(server: ResourceRegistrar, ctx: ResourceContext): void {
  server.resource(
    "user_chat_channels",
    "discourse://user/chat-channels",
    { description: "List user's chat channels (public + DMs) with unread/mention counts. Requires authentication." },
    async (uri) => {
      const { client } = ctx.siteState.ensureSelectedSite();

      try {
        const data = (await client.get("/chat/api/me/channels")) as any;
        const tracking = data?.tracking || {};

        const publicChannels: any[] = data?.public_channels || [];
        const dmChannels: any[] = data?.direct_message_channels || [];

        const publicTransformed: LeanUserChatChannel[] = publicChannels.map((ch) =>
          transformUserChatChannel(ch, tracking)
        );
        const dmTransformed: LeanUserChatChannel[] = dmChannels.map((ch) =>
          transformUserChatChannel(ch, tracking)
        );

        const response = {
          public_channels: publicTransformed,
          dm_channels: dmTransformed,
          meta: {
            total: publicTransformed.length + dmTransformed.length,
          },
        };

        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify(response),
            },
          ],
        };
      } catch (e: any) {
        ctx.logger.error(`Failed to fetch user chat channels: ${e?.message || String(e)}`);
        const response = { public_channels: [], dm_channels: [], meta: { total: 0 } };
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify(response),
            },
          ],
        };
      }
    }
  );
}

/**
 * discourse://user/drafts
 * Lists all drafts for the authenticated user.
 */
function registerUserDraftsResource(server: ResourceRegistrar, ctx: ResourceContext): void {
  server.resource(
    "user_drafts",
    "discourse://user/drafts",
    { description: "List user's drafts with draft_key, sequence, title, category_id, created_at, and reply_preview. Requires authentication." },
    async (uri) => {
      const { client } = ctx.siteState.ensureSelectedSite();

      try {
        const data = (await client.get("/drafts.json")) as any;
        const rawDrafts: any[] = data?.drafts || [];

        const drafts: LeanDraft[] = rawDrafts.map(transformDraft);

        const response = paginatedResponse("drafts", drafts, {
          total: drafts.length,
        });

        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify(response),
            },
          ],
        };
      } catch (e: any) {
        ctx.logger.error(`Failed to fetch drafts: ${e?.message || String(e)}`);
        const response = paginatedResponse("drafts", [], { total: 0 });
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify(response),
            },
          ],
        };
      }
    }
  );
}
