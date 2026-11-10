import { z } from "zod";

const id = z.number().int().positive();
const count = z.number().int().nonnegative();
export const ownerIdSchema = z.union([id, z.literal(-1)]);
const shortName = z.string().trim().min(1).max(100);
const boardName = z.string().trim().min(1).max(255);
const cardTitle = z.string().trim().min(1).max(1000);
const permission = z.enum(["view", "edit", "manage"]);
const minPermission = permission.default("view");
const sort = z.enum(["priority", "recency"]);
const status = z.enum(["open", "closed"]);
const color = z.string().regex(/^#?(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/).transform((value) => value.replace(/^#/, ""));
const tags = (min: number, max: number) => z.array(shortName).min(min).max(max);
const ids = (min: number, max: number) => z.array(id).min(min).max(max).refine((values) => new Set(values).size === values.length, "IDs must be unique");
const hasField = (values: Record<string, unknown>, fields: string[]) => fields.some((key) => values[key] !== undefined);
const columnFields = {
  title: boardName,
  icon: shortName.optional(),
  default_sort: sort.optional(),
  tag_name: shortName.optional(),
  move_to_category_id: id.optional(),
  move_to_assigned: shortName.optional(),
  move_to_status: status.optional(),
};
const initialColumnSchema = z.object(columnFields).strict();
export const constraintFixSchema = z.object({ category_id: id.optional(), tag_names: tags(0, 20).optional() }).strict()
  .refine((value) => hasField(value, ["category_id", "tag_names"]), "constraint_fix requires category_id or tag_names");
export const aclEntryInputSchema = z.object({
  type: z.enum(["group", "user"]), id: id.optional(), name: shortName.optional(), permission,
}).strict().refine((value) => (value.id !== undefined) !== (value.name !== undefined), "Exactly one of id or name is required");

export const columnRecordSchema = z.object({
  id, title: z.string().min(1), position: z.number(), icon: z.string().nullable(), color: z.string().nullable(),
  default_sort: sort, tag_name: z.string().nullable(), move_to_category_id: id.nullable(),
  move_to_assigned: z.string().nullable(), move_to_status: z.string().nullable(),
});
const aclRecordFields = {
  permission: z.string(), display_name: z.string().nullable(), username: z.string().optional(), mandatory: z.boolean(),
};
export const aclEntryRecordSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("group"), id: z.number().int().nonnegative(), ...aclRecordFields }),
  z.object({ type: z.literal("user"), id: ownerIdSchema, ...aclRecordFields }),
]);
export const boardSummarySchema = z.object({
  id, name: z.string().min(1), slug: z.string().min(1), url: z.string(), archived: z.boolean(), old_slug_used: z.boolean(),
  category_ids: z.array(id), tag_names: z.array(z.string()), card_style: z.string(), show_tags: z.boolean(),
  show_topic_thumbnail: z.boolean(), require_confirmation: z.boolean(), anonymous_can_read: z.boolean(),
  can_write: z.boolean(), can_manage: z.boolean(), can_archive: z.boolean(), can_unarchive: z.boolean(), can_manage_acl_owner: z.boolean(),
  owners: z.array(z.object({ id: ownerIdSchema, username: z.string(), name: z.string().nullable() })), columns: z.array(columnRecordSchema),
});
export const boardDetailSchema = boardSummarySchema.omit({ columns: true }).extend({ acl: z.array(aclEntryRecordSchema).nullable() });
export const cardRecordSchema = z.object({
  id, board_id: id, column_id: id, type: z.enum(["topic", "floater"]), position: z.number(), title: z.string().nullable(), url: z.string().nullable(),
  column_changed_at: z.string().nullable(), recency_at: z.string().nullable(),
  topic: z.object({
    id, title: z.string(), slug: z.string(), url: z.string(), category_id: id.nullable(), tags: z.array(z.string()),
    closed: z.boolean(), posts_count: count.nullable(), bumped_at: z.string().nullable(), last_poster_username: z.string().optional(),
    assigned_to_user: z.object({ username: z.string() }).optional(), assigned_to_group: z.object({ name: z.string() }).optional(),
    assignments: z.array(z.object({ target_type: z.string(), target_id: id, username: z.string().optional(), group_name: z.string().optional(), post_number: id.optional() })).optional(),
  }).optional(),
  notes: z.string().nullable().optional(), notes_truncated: z.boolean().optional(), tags: z.array(z.string()).optional(),
  assigned_to: z.object({ type: z.enum(["User", "Group"]), username: z.string().optional(), name: z.string().optional() }).nullable().optional(),
  created_by_username: z.string().nullable().optional(), created_at: z.string().nullable().optional(),
});
const columnWithCardsSchema = columnRecordSchema.extend({ total_card_count: count, card_count: count, truncated: z.boolean(), cards: z.array(cardRecordSchema) });
const warnings = z.array(z.string()).optional();
const columnIdentity = columnRecordSchema.pick({ id: true, title: true });
const taggedColumnIdentity = columnIdentity.extend({ tag_name: z.string().nullable() });
const countedColumn = columnRecordSchema.extend({ total_card_count: count.optional() });

export const listBoardsInputSchema = z.object({ min_permission: minPermission, include_archived: z.boolean().default(false), query: z.string().trim().min(1).max(200).optional() }).strict();
export const listBoardsOutputSchema = z.object({ boards: z.array(boardSummarySchema), meta: z.object({ returned: count, total: count, min_permission: permission, include_archived: z.boolean(), query: z.string().optional() }) });
export const getBoardInputSchema = z.object({ board_id: id, column_ids: ids(1, 50).optional(), card_ids: ids(1, 200).optional(), card_query: z.string().trim().min(1).max(200).optional(), max_cards_per_column: z.number().int().min(1).max(200).default(50), notes_max_chars: z.number().int().min(0).max(50000).default(500) }).strict();
export const getBoardOutputSchema = z.object({ board: boardDetailSchema, columns: z.array(columnWithCardsSchema), meta: z.object({ total_cards: count, matching_cards: count, returned_cards: count, truncated: z.boolean(), max_cards_per_column: count, missing_card_ids: z.array(id).optional() }) });
export const listTopicBoardsInputSchema = z.object({ topic_id: id, min_permission: minPermission }).strict();
export const listTopicBoardsOutputSchema = z.object({ topic_id: id, boards: z.array(z.object({ id, name: z.string().min(1), slug: z.string().min(1), url: z.string(), topic_is_member: z.boolean(), columns: z.array(z.object({ id, title: z.string().min(1), icon: z.string().nullable(), color: z.string().nullable(), topic_is_member: z.boolean(), topic_card_id: id.nullable() })) })), meta: z.object({ returned: count, min_permission: permission }) });

export const createBoardCardInputSchema = z.object({ board_id: id, column_id: id, topic_id: id.optional(), title: cardTitle.optional(), notes: z.string().max(50000).optional(), tag_names: tags(1, 20).optional(), assignee: shortName.optional(), constraint_fix: constraintFixSchema.optional(), allow_tag_creation: z.boolean().default(false) }).strict().superRefine((value, ctx) => {
  if ((value.topic_id !== undefined) === (value.title !== undefined)) ctx.addIssue({ code: "custom", message: "Exactly one of topic_id or title is required" });
  if (value.topic_id !== undefined && hasField(value, ["notes", "tag_names", "assignee"])) ctx.addIssue({ code: "custom", message: "Topic cards cannot have floater fields" });
  if (value.title !== undefined && value.constraint_fix !== undefined) ctx.addIssue({ code: "custom", message: "Floaters cannot have constraint_fix" });
});
export const createBoardCardOutputSchema = z.object({ card: cardRecordSchema, warnings });
export const moveBoardCardInputSchema = z.object({ board_id: id, card_id: id.optional(), topic_id: id.optional(), to_column_id: id.optional(), placement: z.enum(["first", "last", "after"]).optional(), after_card_id: id.optional(), constraint_fix: constraintFixSchema.optional(), confirm_move: z.boolean().optional() }).strict().superRefine((value, ctx) => {
  if ((value.card_id !== undefined) === (value.topic_id !== undefined)) ctx.addIssue({ code: "custom", message: "Exactly one of card_id or topic_id is required" });
  if ((value.placement === "after") !== (value.after_card_id !== undefined)) ctx.addIssue({ code: "custom", message: "after_card_id is required iff placement is after" });
  if (!hasField(value, ["to_column_id", "placement"])) ctx.addIssue({ code: "custom", message: "Provide to_column_id or placement" });
});
export const moveBoardCardOutputSchema = z.object({ card: cardRecordSchema, from_column: columnIdentity, to_column: columnIdentity, applied_column_rules: columnRecordSchema.pick({ tag_name: true, move_to_category_id: true, move_to_assigned: true, move_to_status: true }).extend({ board_has_tagged_columns: z.boolean() }).nullable(), warnings });
export const updateBoardCardInputSchema = z.object({ board_id: id, card_id: id, title: cardTitle.optional(), notes: z.string().max(50000).nullable().optional(), tag_names: tags(0, 20).optional(), assignee: shortName.nullable().optional(), promote_to_topic_id: id.optional(), confirm_promotion: z.boolean().optional(), constraint_fix: constraintFixSchema.optional(), allow_tag_creation: z.boolean().default(false) }).strict().superRefine((value, ctx) => {
  const fields = ["title", "notes", "tag_names", "assignee"];
  if (!hasField(value, [...fields, "promote_to_topic_id"])) ctx.addIssue({ code: "custom", message: "Provide at least one mutable field" });
  if (value.promote_to_topic_id !== undefined && hasField(value, fields)) ctx.addIssue({ code: "custom", message: "Promotion cannot be combined with floater field edits" });
  if (value.constraint_fix !== undefined && value.promote_to_topic_id === undefined) ctx.addIssue({ code: "custom", message: "constraint_fix requires promotion" });
});
export const updateBoardCardOutputSchema = z.object({ card: cardRecordSchema, adopted_floater_id: id.nullable(), warnings });
export const deleteBoardCardInputSchema = z.object({ board_id: id, card_id: id }).strict();
export const deleteBoardCardOutputSchema = z.object({ deleted: z.literal(true), card: cardRecordSchema, column: taggedColumnIdentity, topic_tag_removed: z.string().nullable() });

export const createBoardColumnInputSchema = z.object({ board_id: id, ...columnFields, color: color.optional(), allow_tag_creation: z.boolean().default(false) }).strict();
export const createBoardColumnOutputSchema = z.object({ column: countedColumn, warnings });
const updateColumnFields = ["title", "icon", "color", "default_sort", "tag_name", "move_to_category_id", "move_to_assigned", "move_to_status"];
export const updateBoardColumnInputSchema = z.object({ board_id: id, column_id: id, title: boardName.optional(), icon: shortName.nullable().optional(), color: color.nullable().optional(), default_sort: sort.optional(), tag_name: shortName.nullable().optional(), move_to_category_id: id.nullable().optional(), move_to_assigned: shortName.nullable().optional(), move_to_status: status.nullable().optional(), allow_tag_creation: z.boolean().default(false) }).strict().refine((value) => hasField(value, updateColumnFields), "Provide at least one mutable field");
export const updateBoardColumnOutputSchema = z.object({ column: countedColumn, previous: columnRecordSchema, warnings });
export const moveBoardColumnInputSchema = z.object({ board_id: id, column_id: id, to_position: count }).strict();
export const moveBoardColumnOutputSchema = z.object({ column_id: id, from_position: count, to_position: count, column_order: z.array(id) });
export const clearBoardColumnInputSchema = z.object({ board_id: id, column_id: id, confirm_clear: z.literal(true), expected_card_count: count.optional() }).strict();
export const clearBoardColumnOutputSchema = z.object({ cleared: z.literal(true), column: taggedColumnIdentity, cards_removed: count, topic_cards_removed: count, floater_cards_removed: count, topic_tag_removed: z.string().nullable() });
export const deleteBoardColumnInputSchema = z.object({ board_id: id, column_id: id, column_title: z.string(), confirm_delete: z.literal(true) }).strict();
export const deleteBoardColumnOutputSchema = z.object({ deleted: z.literal(true), column: columnRecordSchema, cards_deleted: count, topic_cards_deleted: count, floater_cards_deleted: count });

const boardFields = { name: boardName, slug: boardName.optional(), category_ids: ids(0, 50).optional(), tag_names: tags(0, 50).optional(), card_style: z.enum(["detailed", "simple"]).optional(), show_tags: z.boolean().optional(), show_topic_thumbnail: z.boolean().optional(), require_confirmation: z.boolean().optional(), acl: z.array(aclEntryInputSchema).max(100), owners: z.array(shortName).min(1).max(20).optional() };
export const createBoardInputSchema = z.object({ ...boardFields, require_confirmation: z.boolean().default(false), columns: z.array(initialColumnSchema).max(30).optional(), allow_tag_creation: z.boolean().default(false) }).strict().superRefine((value, ctx) => {
  const names = (value.columns ?? []).flatMap((column) => column.tag_name ? [column.tag_name.toLocaleLowerCase("en-US")] : []);
  if (new Set(names).size !== names.length) ctx.addIssue({ code: "custom", message: "Column tag names must be unique case-insensitively" });
});
const appliedAclSchema = z.object({ type: z.enum(["group", "user"]), id: z.number().int().nonnegative(), permission, name: z.string().optional() });
export const createBoardOutputSchema = z.object({ board: boardSummarySchema, acl_applied: z.array(appliedAclSchema), owners_requested: z.array(z.object({ id: ownerIdSchema, username: z.string() })).optional() });
export const updateBoardInputSchema = z.object({ board_id: id, ...boardFields, name: boardName.optional(), acl: boardFields.acl.optional(), confirm_access_change: z.boolean().optional(), confirm_card_removal: z.boolean().optional(), allow_tag_creation: z.boolean().default(false) }).strict().refine((value) => hasField(value, Object.keys(boardFields)), "Provide at least one mutable field");
export const updateBoardOutputSchema = z.object({ board: boardDetailSchema, cards_removed_count: count });
export const setBoardArchivedInputSchema = z.object({ board_id: id, archived: z.boolean(), slug: boardName.optional() }).strict().refine((value) => !value.archived || value.slug === undefined, "slug is only valid when unarchiving");
export const setBoardArchivedOutputSchema = z.object({ board: boardSummarySchema });
export const deleteBoardInputSchema = z.object({ board_id: id, name: z.string(), confirm_delete: z.literal(true) }).strict();
export const deleteBoardOutputSchema = z.object({ deleted: z.literal(true), board: z.object({ id, name: z.string(), slug: z.string() }), impact: z.object({ columns: count, visible_cards: count, topic_cards: count, floater_cards: count }) });

export type BoardSummary = z.output<typeof boardSummarySchema>;
export type BoardDetail = z.output<typeof boardDetailSchema>;
export type ColumnRecord = z.output<typeof columnRecordSchema>;
export type CardRecord = z.output<typeof cardRecordSchema>;
export type AclEntryInput = z.output<typeof aclEntryInputSchema>;
