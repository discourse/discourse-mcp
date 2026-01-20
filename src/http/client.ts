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
  httpBasicAuth?: { user: string; pass: string };
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
    if (this.opts.httpBasicAuth) {
      const { user, pass } = this.opts.httpBasicAuth;
      const encoded = Buffer.from(`${user}:${pass}`).toString("base64");
      h["Authorization"] = `Basic ${encoded}`;
    }
    return h;
  }

  async get(path: string, { signal, headers }: { signal?: AbortSignal, headers?: Record<string, string>} = {}) {
    return this.request("GET", path, undefined, { signal, extraHeaders: headers });
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

  async post(path: string, body: unknown, { signal, headers }: { signal?: AbortSignal, headers?: Record<string, string>} = {}) {
    return this.request("POST", path, body, { signal, extraHeaders: headers});
  }

  async delete(path: string, body?: unknown, { signal, headers }: { signal?: AbortSignal, headers?: Record<string, string>} = {}) {
    return this.request("DELETE", path, body, { signal, extraHeaders: headers });
  }

  async put(path: string, body: unknown, { signal, headers }: { signal?: AbortSignal, headers?: Record<string, string>} = {}) {
    return this.request("PUT", path, body, { signal, extraHeaders: headers });
  }

  async postMultipart(path: string, formData: FormData, { signal, headers }: { signal?: AbortSignal, headers?: Record<string, string>} = {}) {
    return this.requestMultipart("POST", path, formData, { signal, extraHeaders: headers });
  }

  private async request(method: string, path: string, body?: unknown, { signal, extraHeaders }: { signal?: AbortSignal, extraHeaders?: Record<string, string>} = {}) {
    const headers = this.headers();
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    if (extraHeaders) {
      Object.assign(headers, extraHeaders);
    }
    return this.executeRequest(method, path, body !== undefined ? JSON.stringify(body) : undefined, headers, signal);
  }

  private async requestMultipart(method: string, path: string, formData: FormData, { signal, extraHeaders }: { signal?: AbortSignal, extraHeaders?: Record<string, string>} = {}) {
    const headers = this.headers();
    if (extraHeaders) {
      Object.assign(headers, extraHeaders);
    }
    // Do NOT set Content-Type - let fetch set it with the multipart boundary
    // Delete after merging extraHeaders to prevent overrides breaking the boundary
    delete headers["Content-Type"];
    // Disable retries for multipart - FormData body is consumed after first attempt
    return this.executeRequest(method, path, formData, headers, signal, /* allowRetries */ false);
  }

  private async executeRequest(method: string, path: string, body: BodyInit | undefined, headers: Record<string, string>, signal?: AbortSignal, allowRetries = true) {
    const url = new URL(path, this.base).toString();
    this.opts.logger.debug(`HTTP ${method} ${url}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.opts.timeoutMs);
    const combinedSignal = mergeSignals([signal, controller.signal]);

    const attempt = async () => {
      try {
        const res = await fetch(url, {
          method,
          headers,
          body,
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
        if (e instanceof HttpError) {
          throw e;
        }

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
      // Disable retries when allowRetries is false (e.g., for multipart where body is consumed)
      const maxRetries = allowRetries ? 3 : 1;
      return await withRetries(attempt, this.opts.logger, url, method, maxRetries);
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function withRetries<T>(fn: () => Promise<T>, logger: Logger, url: string, method: string, retries = 3): Promise<T> {
  let attempt = 0;
  let delay = 250;
  for (;;) {
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
