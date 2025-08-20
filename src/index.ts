#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

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
import { type AuthMode } from "./http/client.js";
import { registerAllTools, type ToolsMode } from "./tools/registry.js";
import { tryRegisterRemoteTools } from "./tools/remote/tool_exec_api.js";
import { SiteState, type AuthOverride } from "./site/state.js";

const DEFAULT_TIMEOUT_MS = 15000;

// CLI config schema
const ProfileSchema = z
  .object({
    auth_pairs: z
      .array(
        z
          .object({
            site: z.string().url(),
            api_key: z.string().optional(),
            api_username: z.string().optional(),
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
  })
  .strict();

type Profile = z.infer<typeof ProfileSchema>;

function parseArgs(argv: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    if (eq !== -1) {
      const key = arg.slice(2, eq);
      const val = arg.slice(eq + 1);
      out[key] = coerceValue(val);
    } else {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        out[key] = coerceValue(next);
        i++;
      } else {
        out[key] = true;
      }
    }
  }
  return out;
}

function coerceValue(val: string): unknown {
  if (val === "true") return true;
  if (val === "false") return false;
  const num = Number(val);
  if (!Number.isNaN(num) && val.trim() !== "") return num;
  return val;
}

async function loadProfile(path?: string): Promise<Partial<Profile>> {
  if (!path) return {};
  const txt = await readFile(path, "utf8");
  const raw = JSON.parse(txt);
  const parsed = ProfileSchema.partial().safeParse(raw);
  if (!parsed.success) throw new Error(`Invalid profile JSON: ${parsed.error.message}`);
  return parsed.data;
}

function mergeConfig(profile: Partial<Profile>, flags: Record<string, unknown>): Profile {
  const merged = {
    auth_pairs: (flags.auth_pairs as any) ?? profile.auth_pairs,
    read_only: (flags.read_only as boolean | undefined) ?? profile.read_only ?? true,
    allow_writes: (flags.allow_writes as boolean | undefined) ?? profile.allow_writes ?? false,
    timeout_ms: (flags.timeout_ms as number | undefined) ?? profile.timeout_ms ?? DEFAULT_TIMEOUT_MS,
    concurrency: (flags.concurrency as number | undefined) ?? profile.concurrency ?? 4,
    cache_dir: (flags.cache_dir as string | undefined) ?? profile.cache_dir,
    log_level: ((flags.log_level as LogLevel | undefined) ?? (profile.log_level as LogLevel | undefined) ?? "info") as LogLevel,
    tools_mode: ((flags.tools_mode as ToolsMode | undefined) ?? (profile.tools_mode as ToolsMode | undefined) ?? "auto") as ToolsMode,
    site: (flags.site as string | undefined) ?? profile.site,
    default_search: ((flags["default-search"] as string | undefined) ?? profile.default_search) as string | undefined,
    max_read_length: ((flags["max-read-length"] as number | undefined) ?? profile.max_read_length ?? 50000) as number,
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
      },
    }
  );

  const allowWrites = Boolean(config.allow_writes && !config.read_only && (config.auth_pairs && config.auth_pairs.length > 0));

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

  await registerAllTools(server as any, siteState, logger, {
    allowWrites,
    toolsMode: config.tools_mode,
    hideSelectSite,
    defaultSearchPrefix: config.default_search,
    maxReadLength: config.max_read_length,
  });

  // If tethered and remote tool discovery is enabled, discover now
  if (config.site && config.tools_mode !== "discourse_api_only") {
    await tryRegisterRemoteTools(server as any, siteState, logger);
  }

  const transport = new StdioServerTransport();

  // Exit cleanly on stdin close or SIGTERM
  const onExit = () => process.exit(0);
  process.on("SIGTERM", onExit);
  process.on("SIGINT", onExit);
  process.stdin.on("close", onExit);

  await server.connect(transport);
}

main().catch((err) => {
  const msg = err?.message || String(err);
  process.stderr.write(`[${new Date().toISOString()}] ERROR ${msg}\n`);
  process.exit(1);
});
