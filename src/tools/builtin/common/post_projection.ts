import { bounded } from "./helpers.js";
import { projectSideLoads } from "./side_loads.js";

function nullable(value: unknown): unknown {
  return value === undefined ? null : value;
}

/** Stable, privacy-conscious projection shared by rich and sparse post endpoints. */
export function projectPost(post: any, maxReadLength: number, options: { includeRaw?: boolean } = {}) {
  const limit = Number.isFinite(maxReadLength) ? maxReadLength : 50_000;
  const rawSource = post?.raw ?? null;
  const excerptSource = post?.excerpt ?? post?.blurb ?? null;
  const projected: Record<string, unknown> = {
    id: nullable(post?.id ?? post?.post_id),
    topic_id: nullable(post?.topic_id),
    post_number: nullable(post?.post_number),
    post_type: nullable(post?.post_type),
    username: nullable(post?.username),
    user_id: nullable(post?.user_id),
    name: nullable(post?.name),
    created_at: nullable(post?.created_at),
    updated_at: nullable(post?.updated_at),
    excerpt: bounded(excerptSource, limit),
    reply_to_post_number: nullable(post?.reply_to_post_number),
    reply_count: nullable(post?.reply_count),
    like_count: nullable(post?.like_count),
    category_id: nullable(post?.category_id ?? post?.topic?.category_id),
    topic_slug: nullable(post?.topic_slug ?? post?.slug ?? post?.topic?.slug),
    topic_title: nullable(post?.topic_title ?? post?.title ?? post?.topic?.title),
    staff: nullable(post?.staff),
    moderator: nullable(post?.moderator),
    admin: nullable(post?.admin),
    hidden: nullable(post?.hidden),
    deleted_at: nullable(post?.deleted_at),
  };
  if (options.includeRaw) {
    projected.raw = bounded(rawSource, limit);
    projected.truncated = rawSource !== null && String(rawSource).length > limit;
  }
  for (const field of ["accepted_answer", "topic_accepted_answer"] as const) {
    if (post && field in post) projected[field] = post[field];
  }
  return projected;
}

export function projectTopic(topic: any) {
  const result: Record<string, unknown> = {
    id: topic?.id ?? null,
    slug: topic?.slug ?? null,
    title: topic?.title ?? null,
    category_id: topic?.category_id ?? null,
    posts_count: topic?.posts_count ?? null,
    reply_count: topic?.reply_count ?? null,
    views: topic?.views ?? null,
    like_count: topic?.like_count ?? null,
    created_at: topic?.created_at ?? null,
    last_posted_at: topic?.last_posted_at ?? null,
    closed: topic?.closed ?? null,
    archived: topic?.archived ?? null,
    tags: Array.isArray(topic?.tags) ? topic.tags : [],
  };
  for (const field of ["has_accepted_answer", "accepted_answers", "solved_count"] as const) {
    if (topic && field in topic) result[field] = topic[field];
  }
  return result;
}

export function projectSlimUser(user: any) {
  return {
    id: user?.id ?? null,
    username: user?.username ?? null,
    name: user?.name ?? null,
    avatar_template: user?.avatar_template ?? null,
    primary_group_name: user?.primary_group_name ?? null,
  };
}

export function projectSearch(data: any, maxReadLength: number) {
  return {
    posts: (Array.isArray(data?.posts) ? data.posts : []).map((post: any) => projectPost(post, maxReadLength)),
    topics: (Array.isArray(data?.topics) ? data.topics : []).map(projectTopic),
    ...projectSideLoads(data),
  };
}
