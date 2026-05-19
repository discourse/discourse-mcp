#!/usr/bin/env node
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { main as startMcp } from "./index.js";
import { parseArgs } from "./util/cli.js";
import { SHUIYUAN_SITE, defaultShuiyuanProfileFile } from "./shuiyuan_defaults.js";

export async function main(rawArgs = process.argv.slice(2)) {
  const args = parseArgs(rawArgs);
  const site = typeof args.site === "string" ? args.site : SHUIYUAN_SITE;
  const profileFile = resolve(typeof args.profile === "string" ? args.profile : defaultShuiyuanProfileFile());

  try {
    await access(profileFile);
  } catch {
    throw new Error(`Shuiyuan profile not found: ${profileFile}. Run shuiyuan-mcp-login first.`);
  }

  await startMcp([
    "--profile",
    profileFile,
    "--site",
    site,
    "--tools_mode",
    "discourse_api_only",
    ...rawArgs,
  ]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    const msg = err?.message || String(err);
    process.stderr.write(`[${new Date().toISOString()}] ERROR ${msg}\n`);
    process.exit(1);
  });
}
