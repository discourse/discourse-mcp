import { homedir } from "node:os";
import { join } from "node:path";

export const SHUIYUAN_SITE = "https://shuiyuan.sjtu.edu.cn";

export function defaultShuiyuanDir(): string {
  const base = process.env.APPDATA || join(homedir(), ".config");
  return join(base, "shuiyuan-mcp");
}

export function defaultShuiyuanCookieFile(): string {
  return join(defaultShuiyuanDir(), "cookies.json");
}

export function defaultShuiyuanProfileFile(): string {
  return join(defaultShuiyuanDir(), "profile.json");
}

export function defaultShuiyuanUserDataDir(): string {
  return join(defaultShuiyuanDir(), "browser-profile");
}
