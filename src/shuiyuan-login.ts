#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type BrowserContext, type Cookie, type Page } from "playwright";
import { main as startMcp } from "./index.js";
import { parseArgs } from "./util/cli.js";
import {
  SHUIYUAN_SITE,
  defaultShuiyuanCookieFile,
  defaultShuiyuanProfileFile,
  defaultShuiyuanUserDataDir,
} from "./shuiyuan_defaults.js";

const require = createRequire(import.meta.url);

type LoginOptions = {
  site: string;
  cookieFile: string;
  profileFile: string;
  userDataDir: string;
  timeoutMs: number;
  start: boolean;
};

export async function main(rawArgs = process.argv.slice(2)) {
  const args = parseArgs(rawArgs);
  const site = typeof args.site === "string" ? args.site : SHUIYUAN_SITE;
  const cookieFile = resolve(typeof args["cookie-file"] === "string" ? args["cookie-file"] : defaultShuiyuanCookieFile());
  const profileFile = resolve(typeof args.profile === "string" ? args.profile : defaultShuiyuanProfileFile());
  const userDataDir = resolve(typeof args["user-data-dir"] === "string" ? args["user-data-dir"] : defaultShuiyuanUserDataDir());
  const timeoutMs = typeof args["timeout-ms"] === "number" ? args["timeout-ms"] : 10 * 60 * 1000;
  const start = Boolean(args.start);

  await loginAndSave({
    site,
    cookieFile,
    profileFile,
    userDataDir,
    timeoutMs,
    start,
  });
}

async function loginAndSave(options: LoginOptions) {
  await mkdir(dirname(options.cookieFile), { recursive: true });
  await mkdir(dirname(options.profileFile), { recursive: true });
  await mkdir(options.userDataDir, { recursive: true });

  process.stderr.write(`Opening Shuiyuan login window: ${options.site}\n`);
  process.stderr.write("Log in with jAccount. This window will close after the Discourse session is detected.\n");

  const context = await launchPersistentContext(options.userDataDir);

  try {
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(options.site, { waitUntil: "domcontentloaded" });

    const cookies = await waitForLogin(context, page, options.site, options.timeoutMs);
    await saveCookies(options.cookieFile, options.site, cookies);
    await saveProfile(options.profileFile, options.site, options.cookieFile);

    process.stderr.write(`Saved Shuiyuan cookies: ${options.cookieFile}\n`);
    process.stderr.write(`Saved MCP profile: ${options.profileFile}\n`);
  } finally {
    await context.close();
  }

  if (options.start) {
    process.stderr.write("Starting Shuiyuan MCP with the saved cookie profile.\n");
    await startMcp([
      "--profile",
      options.profileFile,
      "--site",
      options.site,
      "--tools_mode",
      "discourse_api_only",
    ]);
  }
}

async function launchPersistentContext(userDataDir: string): Promise<BrowserContext> {
  const launch = () => chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: { width: 1280, height: 900 },
  });

  try {
    return await launch();
  } catch (error: any) {
    const message = String(error?.message || error);
    if (!message.includes("Executable doesn't exist") && !message.includes("playwright install")) {
      throw error;
    }

    process.stderr.write("Playwright Chromium is missing. Installing it now...\n");
    const playwrightCli = join(dirname(require.resolve("playwright")), "cli.js");
    const result = spawnSync(process.execPath, [playwrightCli, "install", "chromium"], {
      stdio: "inherit",
    });
    if (result.status !== 0) {
      throw new Error(`Failed to install Playwright Chromium (exit code ${result.status ?? "unknown"})`);
    }

    return await launch();
  }
}

async function waitForLogin(context: BrowserContext, page: Page, site: string, timeoutMs: number): Promise<Cookie[]> {
  const deadline = Date.now() + timeoutMs;
  let lastMessageAt = 0;

  while (Date.now() < deadline) {
    const cookies = await context.cookies(site);
    if (await hasCurrentUser(page, site) || hasDiscourseSessionCookie(cookies)) {
      return cookies;
    }

    if (Date.now() - lastMessageAt > 15_000) {
      process.stderr.write("Still waiting for Shuiyuan login to finish...\n");
      lastMessageAt = Date.now();
    }
    await delay(1000);
  }

  throw new Error(`Timed out after ${timeoutMs}ms waiting for Shuiyuan login`);
}

function hasDiscourseSessionCookie(cookies: Cookie[]): boolean {
  return cookies.some((cookie) => {
    const name = cookie.name.toLowerCase();
    return Boolean(cookie.value) && name === "_t";
  });
}

async function hasCurrentUser(page: Page, site: string): Promise<boolean> {
  try {
    const current = new URL(page.url());
    const target = new URL(site);
    if (current.origin !== target.origin) return false;

    const data = await page.evaluate(async () => {
      const res = await fetch("/session/current.json", {
        credentials: "include",
        headers: { "Accept": "application/json" },
      });
      if (!res.ok) return null;
      return await res.json();
    });

    return Boolean((data as any)?.current_user || (data as any)?.username || (data as any)?.id);
  } catch {
    return false;
  }
}

async function saveCookies(cookieFile: string, site: string, cookies: Cookie[]) {
  await writeFile(
    cookieFile,
    JSON.stringify({
      site,
      saved_at: new Date().toISOString(),
      cookies,
    }, null, 2),
    "utf8",
  );
}

async function saveProfile(profileFile: string, site: string, cookieFile: string) {
  await writeFile(
    profileFile,
    JSON.stringify({
      auth_pairs: [
        {
          site,
          cookie_file: cookieFile,
        },
      ],
      read_only: true,
      allow_writes: false,
      site,
      log_level: "info",
      tools_mode: "discourse_api_only",
    }, null, 2),
    "utf8",
  );
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    const msg = err?.message || String(err);
    process.stderr.write(`[${new Date().toISOString()}] ERROR ${msg}\n`);
    process.exit(1);
  });
}
