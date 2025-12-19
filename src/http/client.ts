import { Logger } from "../util/logger.js";

export type AuthMode =
  | { type: "none" }
  | { type: "api_key"; key: string; username?: string }
  | { type: "user_api_key"; key: string; client_id?: string };

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
  private userAgent = "Discourse-MCP/0.x (+https://github.com/discourse/discourse-mcp)";
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
      if (this.opts.auth.client_id) h["User-Api-Client-Id"] = this.opts.auth.client_id;
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

  async delete(path: string, body?: unknown, { signal }: { signal?: AbortSignal } = {}) {
    return this.request("DELETE", path, body, { signal });
  }

  private async request(method: string, path: string, body?: unknown, { signal }: { signal?: AbortSignal } = {}) {
    const url = new URL(path, this.base).toString();
    const headers = this.headers();
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    this.opts.logger.debug(`HTTP ${method} ${url}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.opts.timeoutMs);
    const combinedSignal = mergeSignals([signal, controller.signal]);

    const attempt = async () => {
      try {
        const res = await fetch(url, {
          method,
          headers,
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: combinedSignal,
        });

        this.opts.logger.debug(`HTTP ${method} ${url} -> ${res.status} ${res.statusText}`);

        if (!res.ok) {
          const text = await safeText(res);
          const errorBody = safeJson(text);
          this.opts.logger.error(`HTTP ${res.status} ${res.statusText} for ${method} ${url}: ${text}`);
          throw new HttpError(res.status, `HTTP ${res.status} ${res.statusText}`, errorBody);
        }
        const ct = res.headers.get("content-type") || "";
        if (ct.includes("application/json")) {
          return res.json();
        } else {
          return res.text();
        }
      } catch (e: any) {
        // Enhanced error logging for fetch failures
        if (e instanceof HttpError) {
          throw e; // Already logged above
        }

        // Check for common fetch failure reasons
        if (e.name === "AbortError") {
          const timeoutMsg = `Request timeout after ${this.opts.timeoutMs}ms for ${method} ${url}`;
          this.opts.logger.error(timeoutMsg);
          throw new Error(timeoutMsg);
        }

        if (e.name === "TypeError" && e.message === "fetch failed") {
          const detailedMsg = `Network error for ${method} ${url}: ${e.message}. Possible causes: DNS resolution failure, network connectivity issue, SSL/TLS error, or server unreachable.`;
          this.opts.logger.error(detailedMsg);
          if (e.cause) {
            this.opts.logger.error(`Underlying cause: ${String(e.cause)}`);
          }
          throw new Error(detailedMsg);
        }

        // Generic network error
        const genericMsg = `Fetch error for ${method} ${url}: ${e.name}: ${e.message}`;
        this.opts.logger.error(genericMsg);
        if (e.cause) {
          this.opts.logger.error(`Cause: ${String(e.cause)}`);
        }
        if (e.stack) {
          this.opts.logger.debug(`Stack: ${e.stack}`);
        }
        throw new Error(`${e.name}: ${e.message}`);
      }
    };

    try {
      return await withRetries(attempt, this.opts.logger, url, method);
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function withRetries<T>(fn: () => Promise<T>, logger: Logger, url: string, method: string, retries = 3): Promise<T> {
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
        logger.info(`Retrying ${method} ${url} (attempt ${attempt}/${retries - 1}) after ${delay}ms due to ${status || 'error'}`);
        await new Promise((r) => setTimeout(r, delay));
        delay *= 2;
        continue;
      }
      // Log final failure
      if (attempt > 0) {
        logger.error(`Request failed after ${attempt + 1} attempts: ${method} ${url}`);
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
