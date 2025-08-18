import { Logger } from "../util/logger.js";

export type AuthMode =
  | { type: "none" }
  | { type: "api_key"; key: string; username?: string }
  | { type: "user_api_key"; key: string };

export interface HttpClientOptions {
  baseUrl: string;
  timeoutMs: number;
  logger: Logger;
  auth: AuthMode;
}

export class HttpError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
    this.name = "HttpError";
  }
}

export class HttpClient {
  private base: URL;
  private userAgent = "Discourse-MCP/0.x (+https://github.com/discourse-mcp)";
  private cache = new Map<string, { value: any; expiresAt: number }>();

  constructor(private opts: HttpClientOptions) {
    this.base = new URL(opts.baseUrl);
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      "User-Agent": this.userAgent,
      "Accept": "application/json",
    };
    if (this.opts.auth.type === "api_key") {
      h["Api-Key"] = this.opts.auth.key;
      if (this.opts.auth.username) h["Api-Username"] = this.opts.auth.username;
    } else if (this.opts.auth.type === "user_api_key") {
      h["User-Api-Key"] = this.opts.auth.key;
    }
    return h;
  }

  async get(path: string, { signal }: { signal?: AbortSignal } = {}) {
    return this.request("GET", path, undefined, { signal });
  }

  async getCached(path: string, ttlMs: number, { signal }: { signal?: AbortSignal } = {}) {
    const url = new URL(path, this.base).toString();
    const entry = this.cache.get(url);
    const now = Date.now();
    if (entry && entry.expiresAt > now) return entry.value;
    const value = await this.request("GET", path, undefined, { signal });
    this.cache.set(url, { value, expiresAt: now + ttlMs });
    return value;
  }

  async post(path: string, body: unknown, { signal }: { signal?: AbortSignal } = {}) {
    return this.request("POST", path, body, { signal });
  }

  private async request(method: string, path: string, body?: unknown, { signal }: { signal?: AbortSignal } = {}) {
    const url = new URL(path, this.base).toString();
    const headers = this.headers();
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.opts.timeoutMs);
    const combinedSignal = mergeSignals([signal, controller.signal]);

    const attempt = async () => {
      const res = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: combinedSignal,
      });
      if (!res.ok) {
        const text = await safeText(res);
        throw new HttpError(res.status, `HTTP ${res.status} ${res.statusText}`, safeJson(text));
      }
      const ct = res.headers.get("content-type") || "";
      if (ct.includes("application/json")) {
        return res.json();
      } else {
        return res.text();
      }
    };

    try {
      return await withRetries(attempt, this.opts.logger);
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function withRetries<T>(fn: () => Promise<T>, logger: Logger, retries = 3): Promise<T> {
  let attempt = 0;
  let delay = 250;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await fn();
    } catch (e: any) {
      const status = e?.status as number | undefined;
      if (attempt < retries - 1 && (status === 429 || (status && status >= 500))) {
        attempt++;
        logger.debug(`HTTP retry #${attempt} after ${delay}ms`);
        await new Promise((r) => setTimeout(r, delay));
        delay *= 2;
        continue;
      }
      throw e;
    }
  }
}

function mergeSignals(signals: Array<AbortSignal | undefined>): AbortSignal {
  const controller = new AbortController();
  for (const s of signals) {
    if (!s) continue;
    if (s.aborted) {
      controller.abort();
      break;
    }
    s.addEventListener("abort", () => controller.abort(), { once: true });
  }
  return controller.signal;
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
