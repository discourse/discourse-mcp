import type { Logger } from "../util/logger.js";
import { HttpClient, type AuthMode } from "../http/client.js";

export type AuthOverride = {
  site: string; // base URL or origin to match
  api_key?: string;
  api_username?: string;
};

function normalizeBase(url: string): string {
  const u = new URL(url);
  u.pathname = "/";
  u.search = "";
  u.hash = "";
  return u.toString().replace(/\/$/, "");
}

export class SiteState {
  private currentSiteBase?: string;
  private currentClient?: HttpClient;
  private readonly clientCache = new Map<string, HttpClient>();

  constructor(
    private opts: {
      logger: Logger;
      timeoutMs: number;
      defaultAuth: AuthMode;
      authOverrides?: AuthOverride[];
    }
  ) {}

  getSiteBase(): string | undefined {
    return this.currentSiteBase;
  }

  ensureSelectedSite(): { base: string; client: HttpClient } {
    if (!this.currentSiteBase || !this.currentClient) {
      throw new Error("No site selected. Call discourse_select_site first.");
    }
    return { base: this.currentSiteBase, client: this.currentClient };
  }

  buildClientForSite(siteUrl: string): { base: string; client: HttpClient } {
    const base = normalizeBase(siteUrl);
    const cached = this.clientCache.get(base);
    if (cached) return { base, client: cached };

    const auth = this.resolveAuthForSite(base);
    const client = new HttpClient({
      baseUrl: base,
      timeoutMs: this.opts.timeoutMs,
      logger: this.opts.logger,
      auth,
    } as any);
    this.clientCache.set(base, client);
    return { base, client };
  }

  selectSite(siteUrl: string): { base: string; client: HttpClient } {
    const { base, client } = this.buildClientForSite(siteUrl);
    this.currentSiteBase = base;
    this.currentClient = client;
    return { base, client };
  }

  private resolveAuthForSite(base: string): AuthMode {
    const overrides = this.opts.authOverrides || [];
    const match = overrides.find((o) => normalizeBase(o.site) === base || this.sameOrigin(o.site, base));
    if (match) {
      if (match.api_key) return { type: "api_key", key: match.api_key, username: match.api_username };
    }
    return this.opts.defaultAuth;
  }

  private sameOrigin(a: string, b: string): boolean {
    try {
      const ua = new URL(a);
      const ub = new URL(b);
      return ua.protocol === ub.protocol && ua.host === ub.host;
    } catch {
      return false;
    }
  }
}

export type SiteStateInit = ConstructorParameters<typeof SiteState>[0];
