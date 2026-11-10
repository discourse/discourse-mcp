import { z } from "zod";
import type { HttpClient } from "../../../http/client.js";
import { defineTool } from "../../definition.js";
import { boardHandler, boardPath, createAnnotations, destructiveAnnotations, fail, fetchBoard, findCard, findColumn, guardTags, mutate, mutationResult, noOp, pickProvided, requireBoardWritable, sameSet } from "./common.js";
import type { BoardSnapshot } from "./common.js";
import { normalizeCard } from "./projections.js";
import { constraintFixSchema, createBoardCardInputSchema, createBoardCardOutputSchema, moveBoardCardInputSchema, moveBoardCardOutputSchema, updateBoardCardInputSchema, updateBoardCardOutputSchema, deleteBoardCardInputSchema, deleteBoardCardOutputSchema } from "./schemas.js";

type ConstraintFix = z.output<typeof constraintFixSchema>;
/** These PUTs are read-only upstream preflights, not mutations. Never invent a fix. */
async function checkConstraints(client: HttpClient, boardId: number, topicId: number, columnId: number, fix: ConstraintFix | undefined, warnings: string[], signal?: AbortSignal, snapshot?: BoardSnapshot) {
  const result = z.object({ categories_needed: z.array(z.number().int().positive()), tags_needed: z.array(z.string()), constraints_need_fixing: z.boolean() }).parse(
    await client.put(boardPath(boardId, "/check-constraint-mismatches"), { topic_id: topicId, target_column_id: columnId }, { signal }),
  );
  if (!result.constraints_need_fixing) {
    if (fix) warnings.push("constraint_fix ignored: the topic already matches the board constraints");
    return undefined;
  }
  if (!fix) fail("constraint_mismatch", "Topic does not match board constraints. Retry with explicit constraint_fix using category_id from categories_needed and/or tag_names from tags_needed; this changes the topic", { categories_needed: result.categories_needed, tags_needed: result.tags_needed });
  if (snapshot && result.categories_needed.length) {
    const target = findColumn(snapshot, columnId);
    if (target.move_to_category_id !== null && !snapshot.board.category_ids.includes(target.move_to_category_id)) {
      fail("unfixable_constraint_mismatch", "The target column's category rule overrides the fix with a category outside the board constraints", { move_to_category_id: target.move_to_category_id, category_ids: snapshot.board.category_ids });
    }
  }
  const validated: ConstraintFix = {};
  if (result.categories_needed.length) {
    if (fix.category_id === undefined) fail("incomplete_constraint_fix", "constraint_fix.category_id is required to satisfy categories_needed", { categories_needed: result.categories_needed });
    if (!result.categories_needed.includes(fix.category_id)) fail("invalid_constraint_fix", "constraint_fix.category_id must be one of categories_needed", { categories_needed: result.categories_needed });
    validated.category_id = fix.category_id;
  } else if (fix.category_id !== undefined) warnings.push("constraint_fix.category_id ignored: no category fix is needed");
  if (result.tags_needed.length) {
    if (!fix.tag_names?.length) fail("incomplete_constraint_fix", "constraint_fix.tag_names must include tags from tags_needed", { tags_needed: result.tags_needed });
    const byName = new Map(result.tags_needed.map((name) => [name.toLocaleLowerCase("en-US"), name]));
    validated.tag_names = fix.tag_names.map((name) => {
      const canonical = byName.get(name.toLocaleLowerCase("en-US"));
      if (!canonical) fail("invalid_constraint_fix", "Every constraint_fix tag must be in tags_needed", { tags_needed: result.tags_needed });
      return canonical;
    });
  } else if (fix.tag_names !== undefined) warnings.push("constraint_fix.tag_names ignored: no tag fix is needed");
  return validated;
}
const warningFields = (warnings: string[]) => warnings.length ? { warnings } : {};

export const createBoardCardTool = defineTool({
  name: "discourse_create_board_card", title: "Create Board Card",
  description: "Add a topic card or standalone floater to Discourse Boards. Topic column rules swap sibling column tags, recategorize, assign/unassign, and open/close the topic when the caller can edit it (creation silently skips topic mutation otherwise); an existing topic card in the column is returned/repositioned. Floaters have card-level notes/tags/assignee; assignment needs discourse-assign. Missing tags require allow_tag_creation. New cards go to the end of priority columns or top of recency columns; use discourse_move_board_card to reposition. Constraint mismatches require an explicit constraint_fix that changes the topic.",
  schema: createBoardCardInputSchema, outputSchema: createBoardCardOutputSchema, availability: "writes_enabled", toolsets: ["boards"], annotations: createAnnotations,
  handler: boardHandler(createBoardCardInputSchema, createBoardCardOutputSchema, "Create board card", true, async (values, extra, { base, client }) => {
    const warnings: string[] = [];
    let fix: ConstraintFix | undefined;
    const card: Record<string, unknown> = { column_id: values.column_id };
    if (values.topic_id !== undefined) {
      fix = await checkConstraints(client, values.board_id, values.topic_id, values.column_id, values.constraint_fix, warnings, extra.signal);
      card.topic_id = values.topic_id;
    } else {
      await guardTags(client, values.tag_names ?? [], values.allow_tag_creation, extra.signal);
      Object.assign(card, pickProvided(values, ["title", "notes", "tag_names"]));
      if (values.assignee !== undefined) card.assigned_to_name = values.assignee;
    }
    const response = await mutate(base, values.board_id, "Create board card", () => client.postNoRetry(boardPath(values.board_id, "/cards"), { card, ...(fix ? { constraint_fix: fix } : {}) }, { signal: extra.signal })) as any;
    return mutationResult("Create board card", () => ({ card: normalizeCard(response?.card, base, values.board_id), ...warningFields(warnings) }));
  }),
});

export const moveBoardCardTool = defineTool({
  name: "discourse_move_board_card", title: "Move Board Card",
  description: "Move/reorder a Discourse Boards card by card_id or unambiguous topic_id. Priority placement is first, last (default across columns), or after a visible card; recency columns always put moved cards first and cannot be reordered. Topic moves swap sibling column tags, recategorize, assign/unassign and open/close according to column rules, requiring topic edit permission. Boards requiring move confirmation need confirm_move: true. Constraint mismatches need explicit constraint_fix (changes topic). Open board UIs update live via MessageBus.",
  schema: moveBoardCardInputSchema, outputSchema: moveBoardCardOutputSchema, availability: "writes_enabled", toolsets: ["boards"], annotations: destructiveAnnotations,
  handler: boardHandler(moveBoardCardInputSchema, moveBoardCardOutputSchema, "Move board card", true, async (values, extra, { base, client }) => {
    const snapshot = await fetchBoard(client, base, values.board_id, extra.signal);
    requireBoardWritable(snapshot.board);
    let source;
    if (values.card_id !== undefined) source = findCard(snapshot, values.card_id);
    else {
      const matches = snapshot.columns.flatMap((column) => column.cards.filter((card) => card.topic?.id === values.topic_id).map((card) => ({ card, column })));
      if (!matches.length) fail("card_not_found", "Topic has no card on this board; use discourse_create_board_card to add it");
      if (matches.length > 1) fail("ambiguous_topic_card", "Topic has multiple cards; specify card_id", { cards: matches.map(({ card, column }) => ({ card_id: card.id, column_id: column.id, column_title: column.title })) });
      source = matches[0];
    }
    const { card, column: from } = source;
    const target = findColumn(snapshot, values.to_column_id ?? from.id);
    const changes = target.id !== from.id;
    if (!changes && values.placement === undefined) noOp();
    const warnings: string[] = [];
    const wire: Record<string, unknown> = { column_id: target.id };
    if (target.default_sort === "recency") {
      if (!changes) fail("recency_column_reorder", "Cards in recency-sorted columns cannot be reordered");
      if (values.placement !== undefined) warnings.push("placement ignored: recency-sorted columns place moved cards first");
    } else if (values.placement === "first") {
      if (!changes && target.cards[0]?.id === card.id) noOp();
      wire.after_card_id = null;
    } else if (values.placement === "after") {
      const anchorIndex = target.cards.findIndex((candidate) => candidate.id === values.after_card_id);
      if (anchorIndex < 0 || values.after_card_id === card.id) fail("invalid_after_card", "after_card_id must be another visible card in the target column");
      if (!changes && target.cards[anchorIndex + 1]?.id === card.id) noOp();
      wire.after_card_id = values.after_card_id;
    } else if (!changes) {
      if (target.cards[target.cards.length - 1]?.id === card.id) noOp();
      wire.after_card_id = target.cards.filter((candidate) => candidate.id !== card.id).at(-1)?.id ?? null;
    }
    const rules = card.type === "topic" && changes ? { tag_name: target.tag_name, move_to_category_id: target.move_to_category_id, move_to_assigned: target.move_to_assigned, move_to_status: target.move_to_status, board_has_tagged_columns: snapshot.columns.some((column) => column.tag_name !== null) } : null;
    if (snapshot.board.require_confirmation && changes && values.confirm_move !== true) fail("confirmation_required", "Board requires confirmation on moves; review target column rules that will change the topic and retry with confirm_move: true", { ...(rules ? { applied_column_rules: rules } : {}) });
    if (card.type === "floater" && values.constraint_fix) fail("invalid_parameters", "Floaters cannot have constraint_fix");
    let fix: ConstraintFix | undefined;
    if (card.type === "topic" && changes) {
      const topicId = z.number().int().positive().parse(card.topic?.id);
      fix = await checkConstraints(client, values.board_id, topicId, target.id, values.constraint_fix, warnings, extra.signal, snapshot);
    } else if (values.constraint_fix) warnings.push("constraint_fix ignored: the topic is not changing column");
    const response = await mutate(base, values.board_id, "Move board card", () => client.putNoRetry(boardPath(values.board_id, `/cards/${card.id}`), { card: wire, ...(fix ? { constraint_fix: fix } : {}) }, { signal: extra.signal })) as any;
    return mutationResult("Move board card", () => ({ card: normalizeCard(response?.card, base, values.board_id, snapshot.board.slug), from_column: { id: from.id, title: from.title }, to_column: { id: target.id, title: target.title }, applied_column_rules: rules, ...warningFields(warnings) }));
  }),
});

export const updateBoardCardTool = defineTool({
  name: "discourse_update_board_card", title: "Update Board Card",
  description: "Edit standalone floater title, notes, tags or assignee (null clears notes/assignee, [] clears tags; a tagged column reapplies its tag). Topic cards take these fields from their topic and cannot be edited here. Missing tags need allow_tag_creation. Promotion to a topic requires confirm_promotion: true: title, notes and tags are discarded, while assignee carries to the topic unless overridden by a column assignment rule other than '*'. Promotion moves the card to the end of its column. An existing topic card in the column is adopted and the floater deleted. Explicit constraint_fix can change the topic.",
  schema: updateBoardCardInputSchema, outputSchema: updateBoardCardOutputSchema, availability: "writes_enabled", toolsets: ["boards"], annotations: destructiveAnnotations,
  handler: boardHandler(updateBoardCardInputSchema, updateBoardCardOutputSchema, "Update board card", true, async (values, extra, { base, client }) => {
    const snapshot = await fetchBoard(client, base, values.board_id, extra.signal);
    requireBoardWritable(snapshot.board);
    const { card, column } = findCard(snapshot, values.card_id);
    if (card.type === "topic") fail("topic_card_fields_not_editable", "Topic cards take their title, tags and assignment from the topic; edit the topic instead");
    const warnings: string[] = [];
    let fix: ConstraintFix | undefined;
    const wire: Record<string, unknown> = {};
    if (values.promote_to_topic_id !== undefined) {
      if (values.confirm_promotion !== true) fail("confirmation_required", "Promotion discards floater title, notes and tags; assignee is carried to the topic when permitted. Retry with confirm_promotion: true");
      fix = await checkConstraints(client, values.board_id, values.promote_to_topic_id, column.id, values.constraint_fix, warnings, extra.signal, snapshot);
      wire.topic_id = values.promote_to_topic_id;
    } else {
      const assignee = card.assigned_to?.username ?? card.assigned_to?.name ?? null;
      if ((values.title === undefined || values.title === card.title) && (values.notes === undefined || (values.notes ?? "") === (card.notes ?? "")) && (values.tag_names === undefined || sameSet(values.tag_names, card.tags ?? [], true)) && (values.assignee === undefined || values.assignee === assignee)) noOp();
      await guardTags(client, values.tag_names ?? [], values.allow_tag_creation, extra.signal, card.tags ?? []);
      Object.assign(wire, pickProvided(values, ["title", "notes", "tag_names"]));
      if (values.assignee !== undefined) wire.assigned_to_name = values.assignee;
    }
    const response = await mutate(base, values.board_id, "Update board card", () => client.putNoRetry(boardPath(values.board_id, `/cards/${card.id}`), { card: wire, ...(fix ? { constraint_fix: fix } : {}) }, { signal: extra.signal })) as any;
    if (response?.adopted_floater_id != null) warnings.push("The topic already had a card in this column; the floater was deleted and the existing topic card is returned");
    return mutationResult("Update board card", () => ({ card: normalizeCard(response?.card, base, values.board_id, snapshot.board.slug), adopted_floater_id: response?.adopted_floater_id ?? null, ...warningFields(warnings) }));
  }),
});

export const deleteBoardCardTool = defineTool({
  name: "discourse_delete_board_card", title: "Delete Board Card",
  description: "Remove a card from Discourse Boards. Floaters are permanently lost; topics are never deleted. For a topic card in a tagged column, Discourse removes that column tag from the topic when the caller can edit the topic. Returns the pre-delete snapshot and tag-removal intent, not proof of topic edit permission.",
  schema: deleteBoardCardInputSchema, outputSchema: deleteBoardCardOutputSchema, availability: "writes_enabled", toolsets: ["boards"], annotations: destructiveAnnotations,
  handler: boardHandler(deleteBoardCardInputSchema, deleteBoardCardOutputSchema, "Delete board card", true, async (values, extra, { base, client }) => {
    const snapshot = await fetchBoard(client, base, values.board_id, extra.signal);
    requireBoardWritable(snapshot.board);
    const { card, column } = findCard(snapshot, values.card_id);
    await mutate(base, values.board_id, "Delete board card", () => client.deleteNoRetry(boardPath(values.board_id, `/cards/${card.id}`), undefined, { signal: extra.signal }));
    return { deleted: true as const, card, column: { id: column.id, title: column.title, tag_name: column.tag_name }, topic_tag_removed: card.type === "topic" ? column.tag_name : null };
  }),
});
