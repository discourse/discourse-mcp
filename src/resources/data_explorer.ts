/**
 * Data Explorer MCP Resources
 *
 * Provides read-only access to database schema and saved queries.
 * Requires admin API key authentication.
 */

import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ResourceRegistrar, ResourceContext } from "./registry.js";
import { requireAdminAccess } from "../util/access.js";

/**
 * Core Discourse tables - the most commonly needed for queries.
 * These are returned by default to keep the schema response compact.
 */
const CORE_TABLES = new Set([
  "users",
  "user_emails",
  "user_profiles",
  "user_stats",
  "user_actions",
  "topics",
  "posts",
  "categories",
  "tags",
  "topic_tags",
  "groups",
  "group_users",
  "notifications",
  "uploads",
  "badges",
  "user_badges",
  "bookmarks",
  "likes",
  "post_actions",
  "topic_views",
]);

/**
 * Extracts error message from admin access error response.
 * Safely parses JSON and falls back to default message.
 */
function getAdminAccessErrorMessage(accessError: { content: Array<{ text?: string }> }): string {
  const errorText = accessError.content[0]?.text || "";
  let message = "Admin API key required";
  try {
    message = JSON.parse(errorText)?.error ?? message;
  } catch {
    // Keep default message if JSON parsing fails
  }
  return message;
}

/**
 * Formats schema as compact text.
 * Format: table: col, col*, col:int, col:ts, col>fk_table
 * - No type = text (default, most common)
 * - :int = integer, :ts = timestamp, :bool = boolean, :json = json
 * - * = sensitive, >table = foreign key
 */
function formatSchemaAsText(
  schema: Record<string, any[]>,
  tablesToInclude: Set<string> | "all"
): { text: string; tableCount: number } {
  const lines: string[] = [];

  const sortedTables = Object.keys(schema).sort();

  for (const tableName of sortedTables) {
    // Case-insensitive comparison for requested tables
    if (tablesToInclude !== "all" && !tablesToInclude.has(tableName.toLowerCase())) {
      continue;
    }

    const columns = schema[tableName];
    if (!Array.isArray(columns)) continue;

    const colDefs = columns.map((col: any) => {
      const name = col.column_name || col.name || "?";
      let suffix = "";

      // Skip type for 'id' columns (Rails convention: always numeric PK)
      // and for text types (implied default)
      if (name !== "id") {
        const type = minimalType(col.data_type || col.type || "");
        if (type) {
          suffix += `:${type}`;
        }
      }

      // Mark sensitive columns
      if (col.sensitive) {
        suffix += "*";
      }

      // Mark foreign keys with >table
      const fkey = col.fkey_info || col.fkey;
      if (fkey && typeof fkey === "string") {
        const fkTable = fkey.split(".")[0];
        suffix += `>${fkTable}`;
      }

      return `${name}${suffix}`;
    });

    lines.push(`${tableName}: ${colDefs.join(", ")}`);
  }

  return { text: lines.join("\n"), tableCount: lines.length };
}

/**
 * Returns minimal type indicator, or empty string for text types (implied default).
 */
function minimalType(type: string): string {
  const t = type.toLowerCase();

  // Text types - no indicator needed (default)
  if (t.includes("char") || t === "text" || t === "citext") {
    return "";
  }

  // Integer types
  if (t === "integer" || t === "int" || t === "bigint" || t === "smallint" || t === "int4" || t === "int8" || t === "int2") {
    return "int";
  }

  // Timestamp types
  if (t.includes("timestamp") || t === "timestamptz") {
    return "ts";
  }

  // Boolean
  if (t === "boolean" || t === "bool") {
    return "bool";
  }

  // JSON
  if (t === "json" || t === "jsonb") {
    return "json";
  }

  // Date (distinct from timestamp)
  if (t === "date") {
    return "date";
  }

  // Float/numeric
  if (t === "numeric" || t === "decimal" || t === "real" || t === "double precision" || t === "float4" || t === "float8") {
    return "num";
  }

  // Keep other types short but visible
  if (t === "bytea") return "bytes";
  if (t === "uuid") return "uuid";
  if (t === "inet" || t === "cidr") return "ip";
  if (t === "interval") return "interval";

  // Unknown/other - show as-is but truncated
  return t.length > 8 ? t.slice(0, 8) : t;
}

/**
 * Helper to fetch and format schema.
 */
async function fetchAndFormatSchema(
  ctx: ResourceContext,
  uri: URL,
  tablesParam: string | undefined
): Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }> {
  const accessError = requireAdminAccess(ctx.siteState);
  if (accessError) {
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "text/plain",
          text: `Error: ${getAdminAccessErrorMessage(accessError)}`,
        },
      ],
    };
  }

  const { client } = ctx.siteState.ensureSelectedSite();

  try {
    const data = (await client.getCached(
      "/admin/plugins/explorer/schema.json",
      60000
    )) as Record<string, any[]>;

    // Determine which tables to include
    let tablesToInclude: Set<string> | "all";
    let isExplicitSelection = false;

    // Normalize tablesParam once and filter empty entries
    const normalized = tablesParam?.trim();
    if (!normalized) {
      // Default: core tables only (already lowercase)
      tablesToInclude = CORE_TABLES;
    } else if (normalized.toLowerCase() === "all") {
      tablesToInclude = "all";
      isExplicitSelection = true;
    } else {
      // Specific tables requested (normalized to lowercase for case-insensitive matching)
      tablesToInclude = new Set(
        normalized.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean)
      );
      // Fall back to core tables if all entries were empty/whitespace
      if (tablesToInclude.size === 0) {
        tablesToInclude = CORE_TABLES;
      } else {
        isExplicitSelection = true;
      }
    }

    const { text, tableCount } = formatSchemaAsText(data, tablesToInclude);
    const totalTables = Object.keys(data).length;

    // Add header with info (use actual tableCount from formatted output)
    const header =
      tablesToInclude === "all"
        ? `-- All ${totalTables} tables | id = PK, no type = text, :int :ts :bool :json | * = sensitive, >t = fkey\n\n`
        : isExplicitSelection
          ? `-- ${tableCount} tables | id = PK, no type = text, :int :ts :bool :json | * = sensitive, >t = fkey\n\n`
          : `-- Core tables (${tableCount}/${totalTables}) | id = PK, no type = text, :int :ts :bool :json | * = sensitive, >t = fkey\n\n`;

    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "text/plain",
          text: header + text,
        },
      ],
    };
  } catch (e: any) {
    ctx.logger.error(`Failed to fetch explorer schema: ${e?.message || String(e)}`);
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "text/plain",
          text: `Error: Failed to fetch schema: ${e?.message || String(e)}`,
        },
      ],
    };
  }
}

/**
 * Registers schema resources:
 * - discourse://explorer/schema (static, returns core tables)
 * - discourse://explorer/schema/{tables} (template, for "all" or specific tables)
 */
export function registerExplorerSchemaResource(
  server: ResourceRegistrar,
  ctx: ResourceContext
): void {
  // Static resource for default (core tables)
  server.resource(
    "explorer_schema",
    "discourse://explorer/schema",
    {
      description:
        "Database schema (core tables). Format: col, col:int, col:ts, col*, col>fk_table. No type = text. Use explorer_schema_tables for all/specific tables.",
    },
    async (uri) => fetchAndFormatSchema(ctx, uri, undefined)
  );

  // Template resource for specific tables
  const template = new ResourceTemplate(
    "discourse://explorer/schema/{tables}",
    { list: undefined }
  );

  server.resource(
    "explorer_schema_tables",
    template,
    {
      description:
        "Database schema for specific tables. Use 'all' for all tables, or comma-separated names (e.g., 'users,topics,posts').",
    },
    async (uri, variables) => {
      const tablesParam = variables.tables as string;
      return fetchAndFormatSchema(ctx, uri, tablesParam);
    }
  );
}

const QUERIES_PER_PAGE = 30;

/**
 * Helper to fetch and format queries with pagination.
 */
async function fetchAndFormatQueries(
  ctx: ResourceContext,
  uri: URL,
  page: number
): Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }> {
  const accessError = requireAdminAccess(ctx.siteState);
  if (accessError) {
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "text/plain",
          text: `Error: ${getAdminAccessErrorMessage(accessError)}`,
        },
      ],
    };
  }

  const { client } = ctx.siteState.ensureSelectedSite();

  try {
    const data = (await client.getCached(
      "/admin/plugins/explorer/queries.json",
      30000
    )) as any;

    // Copy array to avoid mutating cached response
    const rawQueries: any[] = [...(data?.queries || [])];

    // Sort by last_run_at descending (most recently used first), nulls last
    rawQueries.sort((a, b) => {
      if (!a.last_run_at && !b.last_run_at) return 0;
      if (!a.last_run_at) return 1;
      if (!b.last_run_at) return -1;
      return new Date(b.last_run_at).getTime() - new Date(a.last_run_at).getTime();
    });

    // Handle empty query list
    if (rawQueries.length === 0) {
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/plain",
            text: "-- No queries found",
          },
        ],
      };
    }

    // Paginate
    const totalPages = Math.ceil(rawQueries.length / QUERIES_PER_PAGE);
    const safePage = Math.max(1, Math.min(page, totalPages));
    const startIdx = (safePage - 1) * QUERIES_PER_PAGE;
    const pageQueries = rawQueries.slice(startIdx, startIdx + QUERIES_PER_PAGE);

    // Format: "id: name - description" (truncate description)
    const lines = pageQueries.map((q: any) => {
      const name = q.name || "(unnamed)";
      const desc = q.description ? ` - ${truncate(q.description, 80)}` : "";
      return `${q.id}: ${name}${desc}`;
    });

    // Header with pagination info
    let header = `-- Queries (${rawQueries.length} total, p${safePage}/${totalPages}, by last used)\n`;
    if (safePage < totalPages) {
      header += `-- Next: discourse://explorer/queries/${safePage + 1}\n`;
    }
    header += "\n";

    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "text/plain",
          text: header + lines.join("\n"),
        },
      ],
    };
  } catch (e: any) {
    ctx.logger.error(`Failed to fetch explorer queries: ${e?.message || String(e)}`);
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "text/plain",
          text: `Error: Failed to fetch queries: ${e?.message || String(e)}`,
        },
      ],
    };
  }
}

function truncate(str: string, maxLen: number): string {
  const cleaned = str.replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxLen) return cleaned;
  return cleaned.slice(0, maxLen - 3) + "...";
}

/**
 * discourse://explorer/queries - page 1 (default)
 * discourse://explorer/queries/{page} - specific page
 */
export function registerExplorerQueriesResource(
  server: ResourceRegistrar,
  ctx: ResourceContext
): void {
  // Static resource for page 1
  server.resource(
    "explorer_queries",
    "discourse://explorer/queries",
    {
      description:
        "Saved Data Explorer queries (30/page, by last used). Shows id, name, description. Use explorer_queries_page for other pages.",
    },
    async (uri) => fetchAndFormatQueries(ctx, uri, 1)
  );

  // Template resource for pagination
  const template = new ResourceTemplate(
    "discourse://explorer/queries/{page}",
    { list: undefined }
  );

  server.resource(
    "explorer_queries_page",
    template,
    {
      description: "Saved Data Explorer queries - specific page number.",
    },
    async (uri, variables) => {
      const page = parseInt(variables.page as string, 10) || 1;
      return fetchAndFormatQueries(ctx, uri, page);
    }
  );
}
