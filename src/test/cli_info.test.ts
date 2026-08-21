import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const indexPath = path.resolve(__dirname, "../../dist/index.js");
const packagePath = path.resolve(__dirname, "../../package.json");

function run(args: string[], env?: NodeJS.ProcessEnv) {
  return spawnSync("node", [indexPath, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 10_000,
  });
}

test("all top-level version spellings print exactly one version line and exit before startup", async () => {
  const version = JSON.parse(await readFile(packagePath, "utf8")).version;
  for (const token of ["--version", "-v", "version"]) {
    const result = run([token, "--transport", "http", "--port", "3999"]);
    assert.equal(result.status, 0, `${token}: ${result.stderr}`);
    assert.equal(result.stdout, `${version}\n`);
    assert.equal(result.stderr, "");
  }
});

test("all top-level help spellings describe current options and never start a transport", () => {
  for (const token of ["--help", "-h", "help"]) {
    const result = run([token, "--transport", "http", "--port", "3998"]);
    assert.equal(result.status, 0, `${token}: ${result.stderr}`);
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /Usage:/);
    for (const option of [
      "--profile", "--site", "--auth_pairs", "--read_only", "--allow_writes",
      "--tools_mode", "--toolsets", "all", "tag_groups", "--default-search",
      "--max-read-length", "--allowed_upload_paths", "--show_emails", "--transport",
      "--port", "--log_level", "--cache_dir", "generate-user-api-key",
    ]) assert.match(result.stdout, new RegExp(option.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(result.stdout, /listening on/);
  }
});

test("top-level metadata scanning stops at -- and does not steal subcommand help", () => {
  const subcommand = run(["generate-user-api-key", "--help"]);
  assert.match(subcommand.stderr, /Usage: discourse-mcp generate-user-api-key/);
  assert.doesNotMatch(subcommand.stdout, /Discourse MCP server/);

  const stopped = run(["--", "--version"]);
  assert.equal(stopped.stdout, "");
  assert.match(stopped.stderr, /Starting Discourse MCP/);
});

test("profile loading expands current-user ~/ paths while preserving validation wrapping", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "discourse-mcp-home-"));
  try {
    await writeFile(path.join(home, "profile.json"), JSON.stringify({ unknown_profile_key: true }));
    const result = run(["--profile", "~/profile.json"], { HOME: home });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Failed to load profile: Invalid profile JSON/);
    assert.doesNotMatch(result.stderr, /ENOENT/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
