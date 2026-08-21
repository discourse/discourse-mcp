import { HttpError, type HttpClient } from "../http/client.js";
import {
  transformCategory,
  type LeanCategory,
} from "../util/json_response.js";
import { withRateLimit } from "../util/json_response.js";

/** Category search is 1-based and Discourse clamps its page size to 25. */
const CATEGORY_PAGE_SIZE = 25;
/** Group directory pages are 0-based and their size is server-controlled. */
const DEFAULT_MAX_PAGES = 40;
const DEFAULT_DEADLINE_MS = 15_000;
const DEFAULT_CACHE_TTL_MS = 30_000;
const DEFAULT_REQUEST_INTERVAL_MS = 50;

export type DirectoryTruncatedReason =
  | "page_limit"
  | "deadline"
  | "cancelled"
  | "no_new_ids"
  | "total_mismatch"
  | "legacy_site_json"
  | "anonymous_fallback"
  | "upstream_error";

export interface DirectoryMeta {
  total: number;
  reported_total: number | null;
  pages_fetched: number;
  complete: boolean;
  has_more: boolean;
  truncated_reason?: DirectoryTruncatedReason;
  /** Bounded diagnostic for a partial traversal; never includes an upstream body. */
  error?: string;
}

export interface CategoryDirectoryResult {
  categories: LeanCategory[];
  meta: DirectoryMeta;
}

export interface GroupDirectoryResult {
  groups: Array<Record<string, unknown>>;
  meta: DirectoryMeta;
  extras?: unknown;
  total_rows_groups?: number;
  load_more_groups?: string | null;
}

interface TraversalOptions {
  signal?: AbortSignal;
  deadline_ms?: number;
  max_pages?: number;
  max_requests?: number;
  max_results?: number;
  cache_ttl_ms?: number;
  /** Primarily useful for deterministic tests; production calls use paced reads. */
  request_interval_ms?: number;
}

export interface FetchCategoriesOptions extends TraversalOptions {
  authenticated: boolean;
  term?: string;
}

export type FetchGroupsOptions = TraversalOptions;

type DirectoryClient = Pick<HttpClient, "get" | "getCached" | "post">;

const categoryCache = new WeakMap<object, Map<string, { expires: number; value: CategoryDirectoryResult }>>();
const groupCache = new WeakMap<object, Map<string, { expires: number; value: GroupDirectoryResult }>>();
const clientIds = new WeakMap<object, number>();
let nextClientId = 1;

function clientId(client: object): number {
  let id = clientIds.get(client);
  if (!id) {
    id = nextClientId++;
    clientIds.set(client, id);
  }
  return id;
}

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function optionsKey(options: TraversalOptions & Record<string, unknown>): string {
  const stable = Object.entries(options)
    .filter(([key, value]) => value !== undefined && key !== "signal" && key !== "cache_ttl_ms" && key !== "request_interval_ms")
    .sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify(stable);
}

function cacheGet<T>(
  cache: WeakMap<object, Map<string, { expires: number; value: T }>>,
  client: object,
  key: string,
): T | undefined {
  const entry = cache.get(client)?.get(key);
  if (entry && entry.expires > Date.now()) return entry.value;
  if (entry) cache.get(client)?.delete(key);
  return undefined;
}

function cachePut<T>(
  cache: WeakMap<object, Map<string, { expires: number; value: T }>>,
  client: object,
  key: string,
  value: T,
  ttlMs: number,
): void {
  if (ttlMs <= 0) return;
  let entries = cache.get(client);
  if (!entries) {
    entries = new Map();
    cache.set(client, entries);
  }
  entries.set(key, { expires: Date.now() + ttlMs, value });
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 300);
}

function fallbackAllowed(error: unknown): boolean {
  return error instanceof HttpError && [401, 403, 404, 405].includes(error.status);
}

function parseReportedTotal(value: unknown): number | null {
  return Number.isInteger(value) && (value as number) >= 0 ? value as number : null;
}

function flattenCategoryRecords(records: unknown[]): unknown[] {
  const flattened: unknown[] = [];
  const visit = (raw: unknown) => {
    flattened.push(raw);
    const children = (raw as any)?.subcategory_list;
    if (Array.isArray(children)) children.forEach(visit);
  };
  records.forEach(visit);
  return flattened;
}

function categoryPage(body: unknown): { records: unknown[]; reportedTotal: number | null; valid: boolean } {
  const data = body as any;
  const collection = Array.isArray(data?.categories)
    ? data.categories
    : Array.isArray(data?.category_list?.categories)
      ? data.category_list.categories
      : undefined;
  return {
    records: collection ? flattenCategoryRecords(collection) : [],
    reportedTotal: parseReportedTotal(data?.categories_count ?? data?.category_list?.categories_count),
    valid: collection !== undefined,
  };
}

function validGroup(raw: unknown): raw is Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const record = raw as Record<string, unknown>;
  return Number.isInteger(record.id) && (record.id as number) > 0 && typeof record.name === "string" && record.name.length > 0;
}

function incompleteMeta(
  total: number,
  reportedTotal: number | null,
  pagesFetched: number,
  reason: DirectoryTruncatedReason,
  error?: unknown,
): DirectoryMeta {
  return {
    total,
    reported_total: reportedTotal,
    pages_fetched: pagesFetched,
    complete: false,
    has_more: true,
    truncated_reason: reason,
    ...(error === undefined ? {} : { error: errorMessage(error) }),
  };
}

class RequestBudgetExhausted extends Error {}

function interruptionReason(
  callerSignal: AbortSignal | undefined,
  deadlineSignal: AbortSignal,
): "cancelled" | "deadline" | undefined {
  if (callerSignal?.aborted) return "cancelled";
  if (deadlineSignal.aborted) return "deadline";
}

async function paced<T>(
  client: object,
  kind: "categories" | "groups",
  intervalMs: number,
  operation: () => Promise<T>,
): Promise<T> {
  return withRateLimit(`directory:${clientId(client)}:${kind}`, operation, intervalMs);
}

/**
 * Fetch a bounded, stable category directory.
 *
 * Authenticated/anonymous category search is 1-based and returns at most 25
 * rows. Anonymous POST is attempted first; if CSRF/auth policy rejects it, the
 * non-exhaustive nested GET category list is returned as an explicitly labeled
 * anonymous fallback. /site.json is used only when that GET is also rejected,
 * never to mask rate limits, server failures, or transport errors.
 */
export async function fetchAllCategories(
  client: DirectoryClient,
  options: FetchCategoriesOptions,
): Promise<CategoryDirectoryResult> {
  const maxPages = boundedInteger(options.max_pages, DEFAULT_MAX_PAGES, 1, DEFAULT_MAX_PAGES);
  const maxRequests = boundedInteger(options.max_requests, DEFAULT_MAX_PAGES, 1, DEFAULT_MAX_PAGES);
  const maxResults = boundedInteger(options.max_results, 1000, 1, 10_000);
  const deadlineMs = boundedInteger(options.deadline_ms, DEFAULT_DEADLINE_MS, 1, 120_000);
  const deadlineSignal = AbortSignal.timeout(deadlineMs);
  const requestSignal = options.signal
    ? AbortSignal.any([options.signal, deadlineSignal])
    : deadlineSignal;
  const ttlMs = boundedInteger(options.cache_ttl_ms, DEFAULT_CACHE_TTL_MS, 0, 300_000);
  const intervalMs = boundedInteger(options.request_interval_ms, DEFAULT_REQUEST_INTERVAL_MS, 0, 5_000);
  const term = options.term?.trim() || undefined;
  const key = optionsKey({ authenticated: options.authenticated, term, max_pages: maxPages, max_requests: maxRequests, max_results: maxResults, deadline_ms: deadlineMs });
  const cached = cacheGet(categoryCache, client, key);
  if (cached) return cached;

  const categories: LeanCategory[] = [];
  const seen = new Set<number>();
  let pagesFetched = 0;
  let requestsMade = 0;
  let reportedTotal: number | null = null;
  // Try the exhaustive search route even for anonymous clients; deployments
  // differ on whether CSRF/auth policy permits this read-only POST.
  let mode: "post" | "get" = "post";

  const budgeted = async <T>(operation: () => Promise<T>): Promise<T> => {
    if (requestsMade >= maxRequests) throw new RequestBudgetExhausted("Directory request budget exhausted");
    requestsMade++;
    return operation();
  };

  const legacyFallback = async (reason: "legacy_site_json" | "anonymous_fallback"): Promise<CategoryDirectoryResult> => {
    try {
      const body = await paced(client, "categories", intervalMs, () =>
        budgeted(() => client.getCached("/site.json", ttlMs, { signal: requestSignal }))
      );
      pagesFetched++;
      const parsedFallback = categoryPage(body);
      if (!parsedFallback.valid) throw new Error("Malformed category directory wrapper");
      const records = parsedFallback.records;
      const foldedTerm = term?.toLocaleLowerCase("en-US");
      const fallbackCategories = records
        .map(transformCategory)
        .filter((category) => !foldedTerm || category.name.toLocaleLowerCase("en-US").includes(foldedTerm) || category.slug.toLocaleLowerCase("en-US").includes(foldedTerm));
      const boundedCategories = fallbackCategories.slice(0, maxResults);
      const result = {
        categories: boundedCategories,
        meta: incompleteMeta(boundedCategories.length, null, pagesFetched, reason),
      } satisfies CategoryDirectoryResult;
      cachePut(categoryCache, client, key, result, ttlMs);
      return result;
    } catch (error) {
      const interruption = interruptionReason(options.signal, deadlineSignal);
      if (interruption) return { categories, meta: incompleteMeta(categories.length, reportedTotal, pagesFetched, interruption) };
      if (error instanceof RequestBudgetExhausted) return { categories, meta: incompleteMeta(categories.length, reportedTotal, pagesFetched, "page_limit") };
      if (pagesFetched > 0) return { categories, meta: incompleteMeta(categories.length, reportedTotal, pagesFetched, "upstream_error", error) };
      throw error;
    }
  };

  for (let page = 1; page <= maxPages; page++) {
    const interruption = interruptionReason(options.signal, deadlineSignal);
    if (interruption) {
      return { categories, meta: incompleteMeta(categories.length, reportedTotal, pagesFetched, interruption) };
    }
    if (requestsMade >= maxRequests) {
      return { categories, meta: incompleteMeta(categories.length, reportedTotal, pagesFetched, "page_limit") };
    }

    let body: unknown;
    try {
      body = await paced(client, "categories", intervalMs, () => budgeted(async () => {
        if (mode === "post") {
          return client.post("/categories/search.json", {
            ...(term ? { term } : {}),
            page,
            limit: CATEGORY_PAGE_SIZE,
            include_subcategories: true,
          }, { signal: requestSignal });
        }
        const params = new URLSearchParams({ include_subcategories: "true", page: String(page) });
        return client.get(`/categories.json?${params.toString()}`, { signal: requestSignal });
      }));
    } catch (error) {
      const interruption = interruptionReason(options.signal, deadlineSignal);
      if (interruption) {
        return { categories, meta: incompleteMeta(categories.length, reportedTotal, pagesFetched, interruption) };
      }
      if (error instanceof RequestBudgetExhausted) {
        return { categories, meta: incompleteMeta(categories.length, reportedTotal, pagesFetched, "page_limit") };
      }
      if (page === 1 && fallbackAllowed(error)) {
        if (mode === "post") {
          mode = "get";
          page--;
          continue;
        }
        return legacyFallback(options.authenticated ? "legacy_site_json" : "anonymous_fallback");
      }
      if (pagesFetched > 0) {
        const result = { categories, meta: incompleteMeta(categories.length, reportedTotal, pagesFetched, "upstream_error", error) };
        cachePut(categoryCache, client, key, result, ttlMs);
        return result;
      }
      throw error;
    }

    pagesFetched++;
    const postRequestInterruption = interruptionReason(options.signal, deadlineSignal);
    if (postRequestInterruption) {
      return { categories, meta: incompleteMeta(categories.length, reportedTotal, pagesFetched, postRequestInterruption) };
    }
    const parsed = categoryPage(body);
    if (!parsed.valid) {
      const result = {
        categories,
        meta: incompleteMeta(categories.length, reportedTotal, pagesFetched, "upstream_error", "Malformed category directory wrapper"),
      } satisfies CategoryDirectoryResult;
      cachePut(categoryCache, client, key, result, ttlMs);
      return result;
    }
    if (mode === "get") {
      const foldedTerm = term?.toLocaleLowerCase("en-US");
      if (parsed.records.length === 0) {
        const result = {
          categories,
          meta: incompleteMeta(
            categories.length,
            null,
            pagesFetched,
            options.authenticated ? "legacy_site_json" : "anonymous_fallback",
          ),
        } satisfies CategoryDirectoryResult;
        cachePut(categoryCache, client, key, result, ttlMs);
        return result;
      }

      let newIds = 0;
      let malformed = false;
      for (const raw of parsed.records) {
        try {
          const category = transformCategory(raw);
          if (seen.has(category.id)) continue;
          seen.add(category.id);
          newIds++;
          if (!foldedTerm || category.name.toLocaleLowerCase("en-US").includes(foldedTerm) || category.slug.toLocaleLowerCase("en-US").includes(foldedTerm)) {
            categories.push(category);
          }
        } catch {
          malformed = true;
        }
        if (categories.length >= maxResults) break;
      }
      if (malformed) {
        const result = {
          categories,
          meta: incompleteMeta(categories.length, null, pagesFetched, "upstream_error", "Malformed category record"),
        } satisfies CategoryDirectoryResult;
        cachePut(categoryCache, client, key, result, ttlMs);
        return result;
      }
      if (categories.length >= maxResults) {
        const result = { categories: categories.slice(0, maxResults), meta: incompleteMeta(maxResults, null, pagesFetched, "page_limit") };
        cachePut(categoryCache, client, key, result, ttlMs);
        return result;
      }
      if (newIds === 0) {
        const result = { categories, meta: incompleteMeta(categories.length, null, pagesFetched, "no_new_ids") };
        cachePut(categoryCache, client, key, result, ttlMs);
        return result;
      }
      continue;
    }
    if (parsed.reportedTotal !== null) reportedTotal = parsed.reportedTotal;
    if (parsed.records.length === 0) {
      const complete = reportedTotal === null || categories.length === reportedTotal;
      const result: CategoryDirectoryResult = {
        categories,
        meta: complete
          ? { total: categories.length, reported_total: reportedTotal, pages_fetched: pagesFetched, complete: true, has_more: false }
          : incompleteMeta(categories.length, reportedTotal, pagesFetched, "total_mismatch"),
      };
      cachePut(categoryCache, client, key, result, ttlMs);
      return result;
    }

    let newIds = 0;
    let malformed = false;
    for (const raw of parsed.records) {
      try {
        const category = transformCategory(raw);
        if (seen.has(category.id)) continue;
        seen.add(category.id);
        categories.push(category);
        newIds++;
      } catch {
        malformed = true;
      }
      if (categories.length >= maxResults) break;
    }

    if (malformed) {
      const result = {
        categories,
        meta: incompleteMeta(categories.length, reportedTotal, pagesFetched, "upstream_error", "Malformed category record"),
      };
      cachePut(categoryCache, client, key, result, ttlMs);
      return result;
    }
    if (reportedTotal !== null && categories.length === reportedTotal) {
      const result = {
        categories,
        meta: { total: categories.length, reported_total: reportedTotal, pages_fetched: pagesFetched, complete: true, has_more: false },
      } satisfies CategoryDirectoryResult;
      cachePut(categoryCache, client, key, result, ttlMs);
      return result;
    }
    if (categories.length >= maxResults) {
      const result = { categories: categories.slice(0, maxResults), meta: incompleteMeta(maxResults, reportedTotal, pagesFetched, "page_limit") };
      cachePut(categoryCache, client, key, result, ttlMs);
      return result;
    }
    if (newIds === 0) {
      const result = { categories, meta: incompleteMeta(categories.length, reportedTotal, pagesFetched, "no_new_ids") };
      cachePut(categoryCache, client, key, result, ttlMs);
      return result;
    }
  }

  const result = { categories, meta: incompleteMeta(categories.length, reportedTotal, pagesFetched, "page_limit") };
  cachePut(categoryCache, client, key, result, ttlMs);
  return result;
}

/** Fetch all visible groups through the 0-based, server-sized directory pages. */
export async function fetchAllGroups(
  client: DirectoryClient,
  options: FetchGroupsOptions = {},
): Promise<GroupDirectoryResult> {
  const maxPages = boundedInteger(options.max_pages, DEFAULT_MAX_PAGES, 1, DEFAULT_MAX_PAGES);
  const maxRequests = boundedInteger(options.max_requests, DEFAULT_MAX_PAGES, 1, DEFAULT_MAX_PAGES);
  const maxResults = boundedInteger(options.max_results, 2000, 1, 10_000);
  const deadlineMs = boundedInteger(options.deadline_ms, DEFAULT_DEADLINE_MS, 1, 120_000);
  const deadlineSignal = AbortSignal.timeout(deadlineMs);
  const requestSignal = options.signal
    ? AbortSignal.any([options.signal, deadlineSignal])
    : deadlineSignal;
  const ttlMs = boundedInteger(options.cache_ttl_ms, DEFAULT_CACHE_TTL_MS, 0, 300_000);
  const intervalMs = boundedInteger(options.request_interval_ms, DEFAULT_REQUEST_INTERVAL_MS, 0, 5_000);
  const key = optionsKey({ max_pages: maxPages, max_requests: maxRequests, max_results: maxResults, deadline_ms: deadlineMs });
  const cached = cacheGet(groupCache, client, key);
  if (cached) return cached;

  const groups: Array<Record<string, unknown>> = [];
  const seen = new Set<number>();
  let pagesFetched = 0;
  let requestsMade = 0;
  let reportedTotal: number | null = null;
  let extras: unknown;
  let loadMore: string | null | undefined;

  for (let page = 0; page < maxPages; page++) {
    const interruption = interruptionReason(options.signal, deadlineSignal);
    if (interruption) {
      return { groups, meta: incompleteMeta(groups.length, reportedTotal, pagesFetched, interruption), extras, total_rows_groups: reportedTotal ?? undefined, load_more_groups: loadMore };
    }
    if (requestsMade >= maxRequests) {
      return { groups, meta: incompleteMeta(groups.length, reportedTotal, pagesFetched, "page_limit"), extras, total_rows_groups: reportedTotal ?? undefined, load_more_groups: loadMore };
    }

    let body: any;
    try {
      requestsMade++;
      body = await paced(client, "groups", intervalMs, () => client.get(`/groups.json?page=${page}`, { signal: requestSignal }));
    } catch (error) {
      const interruption = interruptionReason(options.signal, deadlineSignal);
      if (interruption) {
        return { groups, meta: incompleteMeta(groups.length, reportedTotal, pagesFetched, interruption), extras, total_rows_groups: reportedTotal ?? undefined, load_more_groups: loadMore };
      }
      if (pagesFetched === 0) throw error;
      const result: GroupDirectoryResult = {
        groups,
        meta: incompleteMeta(groups.length, reportedTotal, pagesFetched, "upstream_error", error),
        extras,
        total_rows_groups: reportedTotal ?? undefined,
        load_more_groups: loadMore,
      };
      cachePut(groupCache, client, key, result, ttlMs);
      return result;
    }

    pagesFetched++;
    const postRequestInterruption = interruptionReason(options.signal, deadlineSignal);
    if (postRequestInterruption) {
      return { groups, meta: incompleteMeta(groups.length, reportedTotal, pagesFetched, postRequestInterruption), extras, total_rows_groups: reportedTotal ?? undefined, load_more_groups: loadMore };
    }
    if (!Array.isArray(body?.groups)) {
      const result: GroupDirectoryResult = {
        groups,
        meta: incompleteMeta(groups.length, reportedTotal, pagesFetched, "upstream_error", "Malformed group directory wrapper"),
        extras,
        total_rows_groups: reportedTotal ?? undefined,
        load_more_groups: loadMore,
      };
      cachePut(groupCache, client, key, result, ttlMs);
      return result;
    }
    const records = body.groups;
    const pageTotal = parseReportedTotal(body?.total_rows_groups);
    if (pageTotal !== null) reportedTotal = pageTotal;
    if (extras === undefined && body?.extras !== undefined) extras = body.extras;
    loadMore = typeof body?.load_more_groups === "string" ? body.load_more_groups : body?.load_more_groups ?? null;

    if (records.length === 0) {
      const complete = reportedTotal === null || groups.length === reportedTotal;
      const result: GroupDirectoryResult = {
        groups,
        meta: complete
          ? { total: groups.length, reported_total: reportedTotal, pages_fetched: pagesFetched, complete: true, has_more: false }
          : incompleteMeta(groups.length, reportedTotal, pagesFetched, "total_mismatch"),
        extras,
        total_rows_groups: reportedTotal ?? undefined,
        load_more_groups: loadMore,
      };
      cachePut(groupCache, client, key, result, ttlMs);
      return result;
    }

    let newIds = 0;
    let malformed = false;
    for (const raw of records) {
      if (!validGroup(raw)) {
        malformed = true;
        continue;
      }
      const id = raw.id as number;
      if (seen.has(id)) continue;
      seen.add(id);
      groups.push(raw);
      newIds++;
      if (groups.length >= maxResults) break;
    }

    if (malformed) {
      const result: GroupDirectoryResult = {
        groups,
        meta: incompleteMeta(groups.length, reportedTotal, pagesFetched, "upstream_error", "Malformed group record"),
        extras,
        total_rows_groups: reportedTotal ?? undefined,
        load_more_groups: loadMore,
      };
      cachePut(groupCache, client, key, result, ttlMs);
      return result;
    }
    if (reportedTotal !== null && groups.length === reportedTotal) {
      const result: GroupDirectoryResult = {
        groups,
        meta: { total: groups.length, reported_total: reportedTotal, pages_fetched: pagesFetched, complete: true, has_more: false },
        extras,
        total_rows_groups: reportedTotal,
        load_more_groups: loadMore,
      };
      cachePut(groupCache, client, key, result, ttlMs);
      return result;
    }
    if (groups.length >= maxResults) {
      const result: GroupDirectoryResult = {
        groups: groups.slice(0, maxResults),
        meta: incompleteMeta(maxResults, reportedTotal, pagesFetched, "page_limit"),
        extras,
        total_rows_groups: reportedTotal ?? undefined,
        load_more_groups: loadMore,
      };
      cachePut(groupCache, client, key, result, ttlMs);
      return result;
    }
    if (newIds === 0) {
      const result: GroupDirectoryResult = {
        groups,
        meta: incompleteMeta(groups.length, reportedTotal, pagesFetched, "no_new_ids"),
        extras,
        total_rows_groups: reportedTotal ?? undefined,
        load_more_groups: loadMore,
      };
      cachePut(groupCache, client, key, result, ttlMs);
      return result;
    }
  }

  const result: GroupDirectoryResult = {
    groups,
    meta: incompleteMeta(groups.length, reportedTotal, pagesFetched, "page_limit"),
    extras,
    total_rows_groups: reportedTotal ?? undefined,
    load_more_groups: loadMore,
  };
  cachePut(groupCache, client, key, result, ttlMs);
  return result;
}
