function projectSlimUser(user: any) {
  return { id: user?.id ?? null, username: user?.username ?? null, name: user?.name ?? null, avatar_template: user?.avatar_template ?? null, primary_group_name: user?.primary_group_name ?? null };
}

function uniqueById<T extends { id: unknown }>(items: T[]): T[] {
  const seen = new Set<unknown>();
  return items.filter((item) => {
    const key = item.id;
    if (key === null || key === undefined || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Privacy-conscious, de-duplicated side-load projection. */
export function projectSideLoads(data: any) {
  return {
    users: uniqueById((Array.isArray(data?.users) ? data.users : []).map(projectSlimUser)),
    categories: uniqueById((Array.isArray(data?.categories) ? data.categories : []).map((category: any) => ({ id: category?.id ?? null, name: category?.name ?? null, slug: category?.slug ?? null }))),
    groups: uniqueById((Array.isArray(data?.groups) ? data.groups : []).map((group: any) => ({ id: group?.id ?? null, name: group?.name ?? null, full_name: group?.full_name ?? null }))),
    tags: Array.isArray(data?.tags) ? data.tags.map((tag: any) => typeof tag === "string" ? tag : { id: tag?.id ?? null, name: tag?.name ?? null }) : [],
  };
}
