import { z } from "zod";
import { aclEntryRecordSchema, boardSummarySchema, boardDetailSchema, cardRecordSchema, columnRecordSchema, listTopicBoardsOutputSchema } from "./schemas.js";

const stringOrNull = (value: unknown): string | null => typeof value === "string" ? value : null;
const numberOrNull = (value: unknown): number | null => typeof value === "number" ? value : null;
const array = (value: unknown): any[] => z.array(z.any()).parse(value ?? []);
const root = (base: string) => base.replace(/\/$/, "");
export const boardUrl = (base: string, slug: string, id: number) => `${root(base)}/boards/${slug}/${id}`;

export function normalizeColumn(raw: any) {
  return columnRecordSchema.parse({
    id: raw?.id, title: raw?.title, position: typeof raw?.position === "number" ? raw.position : 0,
    icon: stringOrNull(raw?.icon), color: stringOrNull(raw?.color), default_sort: raw?.default_sort === "recency" ? "recency" : "priority",
    tag_name: stringOrNull(raw?.tag_name), move_to_category_id: numberOrNull(raw?.move_to_category_id),
    move_to_assigned: stringOrNull(raw?.move_to_assigned), move_to_status: stringOrNull(raw?.move_to_status),
  });
}

export function normalizeAcl(raw: any) {
  return aclEntryRecordSchema.parse({ type: raw?.type, id: raw?.id, permission: raw?.permission,
    display_name: stringOrNull(raw?.display_name), ...(typeof raw?.username === "string" ? { username: raw.username } : {}), mandatory: raw?.mandatory === true });
}

export function normalizeBoard(raw: any, base: string) {
  return boardSummarySchema.parse({
    id: raw?.id, name: raw?.name || raw?.unicode_name, slug: raw?.slug, url: boardUrl(base, raw?.slug, raw?.id),
    archived: raw?.archived === true, old_slug_used: raw?.old_slug_used === true,
    category_ids: array(raw?.category_ids), tag_names: array(raw?.tag_names), card_style: typeof raw?.card_style === "string" ? raw.card_style : "detailed",
    show_tags: raw?.show_tags === true, show_topic_thumbnail: raw?.show_topic_thumbnail === true,
    require_confirmation: raw?.require_confirmation === true, anonymous_can_read: raw?.anonymous_can_read === true,
    can_write: raw?.can_write === true, can_manage: raw?.can_manage === true, can_archive: raw?.can_archive === true,
    can_unarchive: raw?.can_unarchive === true, can_manage_acl_owner: raw?.can_manage_acl_owner === true,
    owners: array(raw?.owners).map((owner) => ({ id: owner?.id, username: owner?.username, name: stringOrNull(owner?.name) })),
    columns: array(raw?.columns).map(normalizeColumn),
  });
}

export function normalizeBoardDetail(raw: any, base: string) {
  const { columns: _columns, ...board } = normalizeBoard(raw, base);
  return boardDetailSchema.parse({ ...board, acl: raw?.acl == null ? null : array(raw.acl).map(normalizeAcl) });
}

export function normalizeCard(raw: any, base: string, boardId: number, boardSlug?: string) {
  const topic = raw?.topic;
  const isTopic = raw?.card_type === "topic";
  const normalizedTopic = topic == null ? undefined : {
    id: topic.id, title: topic.title || topic.unicode_title || raw?.unicode_title || "", slug: typeof topic.slug === "string" ? topic.slug : String(topic.id),
    url: `${root(base)}/t/${topic.slug || topic.id}/${topic.id}`, category_id: numberOrNull(topic.category_id), tags: array(topic.tags),
    closed: topic.closed === true, posts_count: numberOrNull(topic.posts_count), bumped_at: stringOrNull(topic.bumped_at),
    ...(typeof topic.last_poster?.username === "string" ? { last_poster_username: topic.last_poster.username } : {}),
    ...(topic.assigned_to_user ? { assigned_to_user: { username: topic.assigned_to_user.username } } : {}),
    ...(topic.assigned_to_group ? { assigned_to_group: { name: topic.assigned_to_group.name } } : {}),
    ...(topic.assignments !== undefined ? { assignments: array(topic.assignments).map((assignment) => ({
      target_type: assignment?.target_type, target_id: assignment?.target_id,
      ...(typeof assignment?.username === "string" ? { username: assignment.username } : {}),
      ...(typeof assignment?.group_name === "string" ? { group_name: assignment.group_name } : {}),
      ...(typeof assignment?.post_number === "number" ? { post_number: assignment.post_number } : {}),
    })) } : {}),
  };
  return cardRecordSchema.parse({
    id: raw?.id, board_id: raw?.board_id ?? boardId, column_id: raw?.column_id, type: raw?.card_type,
    position: typeof raw?.position === "number" ? raw.position : 0,
    title: isTopic ? stringOrNull(topic?.title || topic?.unicode_title || raw?.unicode_title) : stringOrNull(raw?.title || raw?.unicode_title),
    url: boardSlug ? `${boardUrl(base, boardSlug, boardId)}/cards/${raw?.id}` : null,
    column_changed_at: stringOrNull(raw?.column_changed_at), recency_at: stringOrNull(raw?.recency_at),
    ...(isTopic ? { ...(normalizedTopic ? { topic: normalizedTopic } : {}) } : {
      notes: stringOrNull(raw?.notes), tags: array(raw?.tags).map((tag) => typeof tag === "string" ? tag : tag?.name),
      assigned_to: raw?.assigned_to ? { type: raw.assigned_to.type,
        ...(typeof raw.assigned_to.username === "string" ? { username: raw.assigned_to.username } : {}),
        ...(typeof raw.assigned_to.name === "string" ? { name: raw.assigned_to.name } : {}),
      } : null,
      created_by_username: stringOrNull(raw?.created_by?.username), created_at: stringOrNull(raw?.created_at),
    }),
  });
}

export function normalizeAvailable(raw: any, base: string) {
  return listTopicBoardsOutputSchema.shape.boards.element.parse({
    id: raw?.id, name: raw?.unicode_name, slug: raw?.slug, url: boardUrl(base, raw?.slug, raw?.id), topic_is_member: raw?.topic_is_member === true,
    columns: z.array(z.any()).parse(raw?.columns).map((column) => ({
      id: column?.id, title: column?.unicode_title, icon: stringOrNull(column?.icon), color: stringOrNull(column?.color),
      topic_is_member: column?.topic_is_member === true, topic_card_id: column?.topic_card_id ?? null,
    })),
  });
}
