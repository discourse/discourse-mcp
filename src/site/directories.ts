import type { HttpClient } from "../http/client.js";

const CATEGORY_PAGE_SIZE = 25;
const MAX_DIRECTORY_PAGES = 500;

function addUniqueById(items: Map<number, any>, rawItems: unknown): number {
  if (!Array.isArray(rawItems)) return 0;

  for (const raw of rawItems) {
    if (
      raw &&
      typeof raw === "object" &&
      typeof (raw as any).id === "number" &&
      Number.isInteger((raw as any).id)
    ) {
      items.set((raw as any).id, raw);
    }
  }

  return rawItems.length;
}

function reportedTotal(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

/**
 * Fetch every category visible to the configured API user. Unlike /site.json,
 * the category search endpoint is complete when category lazy-loading is enabled.
 */
export async function fetchAllCategories(client: HttpClient): Promise<any[]> {
  const categories = new Map<number, any>();
  let total: number | undefined;

  for (let page = 1; page <= MAX_DIRECTORY_PAGES; page++) {
    const sizeBefore = categories.size;
    const data = (await client.post("/categories/search.json", {
      term: "",
      include_subcategories: true,
      page,
      limit: CATEGORY_PAGE_SIZE,
    })) as any;
    const rawCount = addUniqueById(categories, data?.categories);
    total = reportedTotal(data?.categories_count) ?? total;

    // Stop on an empty page, once the reported total is covered, or when a
    // page yields no new IDs (a server that ignores the page param would
    // otherwise repeat the same page forever).
    if (
      rawCount === 0 ||
      categories.size === sizeBefore ||
      (total !== undefined && categories.size >= total)
    ) {
      return [...categories.values()];
    }
  }

  throw new Error("Category directory exceeded the pagination safety limit");
}

/** Fetch every group page and deduplicate groups by numeric ID. */
export async function fetchAllGroups(client: HttpClient): Promise<any[]> {
  const groups = new Map<number, any>();
  let total: number | undefined;

  for (let page = 0; page < MAX_DIRECTORY_PAGES; page++) {
    const sizeBefore = groups.size;
    const data = (await client.get(`/groups.json?page=${page}`)) as any;
    const rawCount = addUniqueById(groups, data?.groups);
    total = reportedTotal(data?.total_rows_groups) ?? total;

    if (
      rawCount === 0 ||
      groups.size === sizeBefore ||
      (total !== undefined && groups.size >= total)
    ) {
      return [...groups.values()];
    }
  }

  throw new Error("Group directory exceeded the pagination safety limit");
}

/** Fetch all staff-visible tag groups and deduplicate them by numeric ID. */
export async function fetchAllTagGroups(client: HttpClient): Promise<any[]> {
  const data = (await client.get("/tag_groups.json")) as any;
  const tagGroups = new Map<number, any>();
  addUniqueById(tagGroups, data?.tag_groups);
  return [...tagGroups.values()];
}
