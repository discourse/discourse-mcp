import type { SiteState } from "../site/state.js";
import { jsonError } from "./json_response.js";

type AuthRequirement = "any" | "admin";

function requireSiteAuth(siteState: SiteState, requirement: AuthRequirement) {
  const base = siteState.getSiteBase();
  if (!base) {
    return jsonError("No site selected. Call discourse_select_site first.");
  }

  const authType = siteState.getAuthType(base);
  if (authType === "none") {
    return jsonError(
      `No auth configured for selected site (${base}). Add a matching auth_pairs entry and restart.`,
    );
  }

  if (requirement === "admin" && authType !== "api_key" && authType !== "user_api_key") {
    return jsonError(`Admin API key or admin user API key required for selected site (${base}).`);
  }

  return null;
}

export function requireWriteAccess(siteState: SiteState, allowWrites: boolean) {
  if (!allowWrites) {
    return jsonError("Writes are disabled. Run with --allow_writes --read_only=false to enable.");
  }
  return requireSiteAuth(siteState, "any");
}

export function requireAdminAccess(siteState: SiteState) {
  return requireSiteAuth(siteState, "admin");
}
