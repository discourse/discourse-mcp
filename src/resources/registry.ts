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
  type LeanCategory,
  type LeanGroup,
  type LeanTag,
  type LeanChatChannel,
  type LeanUserChatChannel,
  type LeanDraft,
} from "../util/json_response.js";

export interface ResourceContext {
  siteState: SiteState;
  logger: Logger;
}

/**
 * Registers all MCP resources.
 * Resources are read-only, URI-addressable data endpoints.
 */
export function registerAllResources(
  server: McpServer,
  ctx: ResourceContext
): void {
  registerCategoriesResource(server, ctx);
  registerTagsResource(server, ctx);
  registerGroupsResource(server, ctx);
  registerChatChannelsResource(server, ctx);
  registerUserChatChannelsResource(server, ctx);
  registerUserDraftsResource(server, ctx);
}

/**
 * discourse://site/categories
 * Lists all categories with hierarchy and permissions.
 */
function registerCategoriesResource(server: McpServer, ctx: ResourceContext): void {
  server.resource(
    "site_categories",
    "discourse://site/categories",
    { description: "List all categories with hierarchy (pid), permissions (perms), and counts. Use for migration workflows." },
    async (uri) => {
      const { client } = ctx.siteState.ensureSelectedSite();
      
      const siteData = (await client.getCached("/site.json", 30000)) as any;
      const siteCategories: any[] = siteData?.categories || [];
      const categoryIds = siteCategories.map((c: any) => c.id);
      
      // Try to get detailed permissions via /categories/find.json?include_permissions=true
      let rawCategories = siteCategories;
      if (categoryIds.length > 0) {
        try {
          const idsParams = categoryIds.map((id: number) => `ids[]=${id}`).join("&");
          const findData = (await client.getCached(
            `/categories/find.json?include_permissions=true&${idsParams}`,
            30000
          )) as any;
          if (Array.isArray(findData?.categories) && findData.categories.length > 0) {
            rawCategories = findData.categories;
          }
        } catch {
          // Fall back to site.json data if find endpoint fails
        }
      }

      const categories: LeanCategory[] = rawCategories.map(transformCategory);

      const response = paginatedResponse("categories", categories, {
        total: categories.length,
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
    }
  );
}

/**
 * discourse://site/tags
 * Lists all tags with usage counts.
 */
function registerTagsResource(server: McpServer, ctx: ResourceContext): void {
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
function registerGroupsResource(server: McpServer, ctx: ResourceContext): void {
  server.resource(
    "site_groups",
    "discourse://site/groups",
    { description: "List all groups with visibility, interaction levels, and access settings. Levels: 0=public, 1=logged_on_users, 2=members, 3=staff, 4=owners." },
    async (uri) => {
      const { client } = ctx.siteState.ensureSelectedSite();

      try {
        const data = (await client.get("/groups.json")) as any;
        const rawGroups: any[] = data?.groups || [];

        const groups: LeanGroup[] = rawGroups.map(transformGroup);

        const response = paginatedResponse("groups", groups, {
          total: groups.length,
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
        ctx.logger.error(`Failed to fetch groups: ${e?.message || String(e)}`);
        const response = paginatedResponse("groups", [], { total: 0 });
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
 * discourse://chat/channels
 * Lists all public chat channels.
 */
function registerChatChannelsResource(server: McpServer, ctx: ResourceContext): void {
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
function registerUserChatChannelsResource(server: McpServer, ctx: ResourceContext): void {
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
function registerUserDraftsResource(server: McpServer, ctx: ResourceContext): void {
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
