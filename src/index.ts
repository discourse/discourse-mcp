#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { generateUserApiKey, type GenerateOptions } from "./user-api-key-generator.js";

// Read package version at runtime to avoid import-attributes incompatibility
async function getPackageVersion(): Promise<string> {
  try {
    const pkgPath = new URL("../package.json", import.meta.url);
    const raw = await readFile(pkgPath, "utf8");
    const pkg = JSON.parse(raw) as { version?: string };
    return pkg.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}
import { Logger, type LogLevel } from "./util/logger.js";
import { redactObject } from "./util/redact.js";
import { parseArgs } from "./util/cli.js";
import { type AuthMode } from "./http/client.js";
import { registerAllTools, type ToolsMode } from "./tools/registry.js";
import { tryRegisterRemoteTools } from "./tools/remote/tool_exec_api.js";
import { registerAllResources } from "./resources/registry.js";
import { SiteState, type AuthOverride } from "./site/state.js";

const DEFAULT_TIMEOUT_MS = 15000;

// CLI config schema - see also src/util/cli.ts for parseArgs
const ProfileSchema = z
  .object({
    auth_pairs: z
      .array(
        z
          .object({
            site: z.string().url(),
            api_key: z.string().optional(),
            api_username: z.string().optional(),
            user_api_key: z.string().optional(),
            user_api_client_id: z.string().optional(),
            http_basic_user: z.string().optional(),
            http_basic_pass: z.string().optional(),
          })
          .strict()
      )
      .optional(),
    read_only: z.boolean().optional().default(true),
    allow_writes: z.boolean().optional().default(false),
    timeout_ms: z.number().int().positive().optional().default(DEFAULT_TIMEOUT_MS),
    concurrency: z.number().int().positive().optional().default(4),
    cache_dir: z.string().optional(),
    log_level: z.enum(["silent", "error", "info", "debug"]).optional().default("info"),
    tools_mode: z.enum(["auto", "discourse_api_only", "tool_exec_api"]).optional().default("auto"),
    site: z.string().url().optional().describe("Tether MCP to a single Discourse site; hides select_site and preselects this site"),
    default_search: z.string().optional().describe("Optional search prefix added to every search query (set via --default-search)"),
    max_read_length: z
      .number()
      .int()
      .positive()
      .optional()
      .default(50000)
      .describe("Maximum number of characters to include when returning post content (set via --max-read-length)"),
    transport: z.enum(["stdio", "http"]).optional().default("stdio").describe("Transport type: stdio (default) or http"),
    port: z.number().int().positive().optional().default(3000).describe("Port to listen on when using HTTP transport"),
    allowed_upload_paths: z.union([z.array(z.string()), z.string()])
      .optional()
      .transform((val) => {
        // Normalize to array (parseAllowedUploadPaths handles this, but schema re-validates after merge)
        if (val === undefined) return undefined;
        if (Array.isArray(val)) return val;
        // Comma-separated string
        return val.split(",").map(s => s.trim()).filter(Boolean);
      })
      .describe("Allowed directories for local file uploads (array or comma-separated string)"),
  })
  .strict();

type Profile = z.infer<typeof ProfileSchema>;

async function loadProfile(path?: string): Promise<Partial<Profile>> {
  if (!path) return {};
  const txt = await readFile(path, "utf8");
  const raw = JSON.parse(txt);
  const parsed = ProfileSchema.partial().safeParse(raw);
  if (!parsed.success) throw new Error(`Invalid profile JSON: ${parsed.error.message}`);
  return parsed.data;
}

function parseAllowedUploadPaths(value: unknown, source: string): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") {
    const trimmed = value.trim();
    // Try parsing as JSON array first
    if (trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parsed.map(String);
        throw new Error(`allowed_upload_paths ${source} must be an array, got ${typeof parsed}`);
      } catch (e: any) {
        if (e.message?.includes("allowed_upload_paths")) throw e;
        throw new Error(`Failed to parse allowed_upload_paths ${source} as JSON: ${e.message}`);
      }
    }
    // Parse as comma-separated list
    return value.split(",").map(s => s.trim()).filter(Boolean);
  }
  throw new Error(`allowed_upload_paths ${source} must be a string or array, got ${typeof value}`);
}

function mergeConfig(profile: Partial<Profile>, flags: Record<string, unknown>): Profile {
  const merged = {
    auth_pairs: (flags.auth_pairs as any) ?? profile.auth_pairs,
    read_only: ((flags.read_only ?? flags["read-only"]) as boolean | undefined) ?? profile.read_only ?? true,
    allow_writes: ((flags.allow_writes ?? flags["allow-writes"]) as boolean | undefined) ?? profile.allow_writes ?? false,
    timeout_ms: ((flags.timeout_ms ?? flags["timeout-ms"]) as number | undefined) ?? profile.timeout_ms ?? DEFAULT_TIMEOUT_MS,
    concurrency: (flags.concurrency as number | undefined) ?? profile.concurrency ?? 4,
    cache_dir: ((flags.cache_dir ?? flags["cache-dir"]) as string | undefined) ?? profile.cache_dir,
    log_level: (((flags.log_level ?? flags["log-level"]) as LogLevel | undefined) ?? (profile.log_level as LogLevel | undefined) ?? "info") as LogLevel,
    tools_mode: (((flags.tools_mode ?? flags["tools-mode"]) as ToolsMode | undefined) ?? (profile.tools_mode as ToolsMode | undefined) ?? "auto") as ToolsMode,
    site: (flags.site as string | undefined) ?? profile.site,
    default_search: (((flags.default_search ?? flags["default-search"]) as string | undefined) ?? profile.default_search) as string | undefined,
    max_read_length: (((flags.max_read_length ?? flags["max-read-length"]) as number | undefined) ?? profile.max_read_length ?? 50000) as number,
    transport: ((flags.transport as "stdio" | "http" | undefined) ?? profile.transport ?? "stdio") as "stdio" | "http",
    port: ((flags.port as number | undefined) ?? profile.port ?? 3000) as number,
    allowed_upload_paths: parseAllowedUploadPaths(flags.allowed_upload_paths ?? flags["allowed-upload-paths"], "from CLI") ?? parseAllowedUploadPaths(profile.allowed_upload_paths, "from profile"),
  } satisfies Profile;
  const result = ProfileSchema.safeParse(merged);
  if (!result.success) throw new Error(`Invalid configuration: ${result.error.message}`);
  return result.data;
}

function buildAuth(_config: Profile): AuthMode {
  // Global default is no auth; use per-site overrides via auth_pairs when provided
  return { type: "none" };
}

async function main() {
  // Check if user wants to generate a User API Key
  const args = process.argv.slice(2);
  if (args[0] === "generate-user-api-key") {
    // Use rawStrings to preserve nonce/payload values (e.g., leading zeros in numeric strings)
    const subArgs = parseArgs(args.slice(1), { rawStrings: true });

    // Show help if requested
    if (subArgs.help || subArgs.h) {
      await generateUserApiKey({ site: "" }); // Will show help and exit
      return;
    }

    // Map parsed args to GenerateOptions (kebab-case CLI to camelCase options)
    // All values are already strings due to rawStrings option
    const options: GenerateOptions = {
      site: (subArgs.site as string) ?? "",
      scopes: subArgs.scopes as string | undefined,
      applicationName: subArgs["application-name"] as string | undefined,
      clientId: subArgs["client-id"] as string | undefined,
      nonce: subArgs.nonce as string | undefined,
      payload: subArgs.payload as string | undefined,
      saveTo: subArgs["save-to"] as string | undefined,
    };

    await generateUserApiKey(options);
    return;
  }

  const argv = parseArgs(process.argv.slice(2));
  const profilePath = (argv.profile as string | undefined) ?? undefined;
  const profile = await loadProfile(profilePath).catch((e) => {
    throw new Error(`Failed to load profile: ${e?.message || String(e)}`);
  });
  const config = mergeConfig(profile, argv);

  const logger = new Logger(config.log_level);
  const auth = buildAuth(config);

  // Meta log (stderr) without leaking secrets
  const version = await getPackageVersion();
  logger.info(`Starting Discourse MCP v${version}`);
  logger.debug(`Config: ${JSON.stringify(redactObject({ ...config }))}`);

  // Initialize dynamic site state
  let authOverrides: AuthOverride[] | undefined = undefined;
  if (Array.isArray(config.auth_pairs)) {
    authOverrides = config.auth_pairs as unknown as AuthOverride[];
  } else if (typeof (config as any).auth_pairs === "string") {
    try {
      const parsed = JSON.parse((config as any).auth_pairs);
      if (Array.isArray(parsed)) authOverrides = parsed as AuthOverride[];
    } catch {
      // ignore
    }
  }
  const siteState = new SiteState({
    logger,
    timeoutMs: config.timeout_ms,
    defaultAuth: auth,
    authOverrides,
  });

  const server = new McpServer(
    {
      name: "@discourse/mcp",
      version,
    },
    {
      capabilities: {
        tools: { listChanged: false },
        resources: { listChanged: false },
      },
    }
  );

  const allowWrites = Boolean(config.allow_writes && !config.read_only && (config.auth_pairs && config.auth_pairs.length > 0));
  const hasAdminApiKey = Boolean(config.auth_pairs?.some(p => p.api_key));

  // If tethered to a site, validate and preselect it before registering tools,
  // and trigger remote tool discovery when enabled.
  let hideSelectSite = false;
  if (config.site) {
    try {
      const { base, client } = siteState.buildClientForSite(config.site);
      const about = (await client.get(`/about.json`)) as any;
      const title = about?.about?.title || about?.title || base;
      siteState.selectSite(base);
      hideSelectSite = true;
      logger.info(`Tethered to site: ${base} (${title})`);
    } catch (e: any) {
      throw new Error(`Failed to validate --site ${config.site}: ${e?.message || String(e)}`);
    }
  }

  await registerAllTools(server, siteState, logger, {
    allowWrites,
    toolsMode: config.tools_mode,
    hideSelectSite,
    defaultSearchPrefix: config.default_search,
    maxReadLength: config.max_read_length,
    allowedUploadPaths: config.allowed_upload_paths,
    hasAdminApiKey,
  });

  // Register MCP resources (URI-addressable read-only data)
  registerAllResources(server, { siteState, logger });

  // If tethered and remote tool discovery is enabled, discover now
  if (config.site && config.tools_mode !== "discourse_api_only") {
    await tryRegisterRemoteTools(server, siteState, logger);
  }

  // Create transport based on configuration
  if (config.transport === "http") {
    // HTTP transport using Streamable HTTP (stateless mode)
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // Stateless mode
      enableJsonResponse: true,
    });

    await server.connect(transport);

    const httpServer = createServer(async (req, res) => {
      // Health check endpoint
      if (req.method === "GET" && req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
        return;
      }

      // MCP endpoint - handle via StreamableHTTPServerTransport
      if (req.url === "/mcp" || req.url === "/") {
        let body = "";
        req.on("data", (chunk) => {
          body += chunk;
        });
        req.on("end", async () => {
          try {
            const parsedBody = body ? JSON.parse(body) : undefined;
            await transport.handleRequest(req, res, parsedBody);
          } catch (error) {
            logger.error(`Request handling error: ${error}`);
            if (!res.headersSent) {
              res.writeHead(500, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "Internal server error" }));
            }
          }
        });
        return;
      }

      // Unknown endpoint
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    });

    httpServer.listen(config.port, () => {
      logger.info(`HTTP transport listening on port ${config.port}`);
      logger.info(`Health check available at http://localhost:${config.port}/health`);
      logger.info(`MCP endpoint available at http://localhost:${config.port}/mcp`);
    });

    // Exit cleanly on SIGTERM/SIGINT
    const onExit = () => {
      httpServer.close(() => {
        transport.close().then(() => {
          logger.info("HTTP server closed");
          process.exit(0);
        });
      });
    };
    process.on("SIGTERM", onExit);
    process.on("SIGINT", onExit);
  } else {
    // Default stdio transport
    const transport = new StdioServerTransport();

    // Exit cleanly on stdin close or SIGTERM
    const onExit = () => process.exit(0);
    process.on("SIGTERM", onExit);
    process.on("SIGINT", onExit);
    process.stdin.on("close", onExit);

    await server.connect(transport);
  }
}

main().catch((err) => {
  const msg = err?.message || String(err);
  process.stderr.write(`[${new Date().toISOString()}] ERROR ${msg}\n`);
  process.exit(1);
});
