import { z } from "zod";
import { defineTool } from "../../definition.js";
import type { HttpClient } from "../../../http/client.js";
import { BoardToolError, boardHandler, boardPath, boardsError, columnMutableKeys, createAnnotations, destructiveAnnotations, fail, fetchBoard, findColumn, guardTags, mutate, mutationResult, noOp, outcomeUnknown, pickProvided, requireBoardManageable, requireBoardWritable } from "./common.js";
import { normalizeColumn } from "./projections.js";
import { createBoardColumnInputSchema, createBoardColumnOutputSchema, updateBoardColumnInputSchema, updateBoardColumnOutputSchema, moveBoardColumnInputSchema, moveBoardColumnOutputSchema, clearBoardColumnInputSchema, clearBoardColumnOutputSchema, deleteBoardColumnInputSchema, deleteBoardColumnOutputSchema } from "./schemas.js";

async function rereadColumn(client: HttpClient, base: string, boardId: number, columnId: number, response: any, tagName: string | null, action: string, signal?: AbortSignal) {
  try {
    const column = findColumn(await fetchBoard(client, base, boardId, signal), columnId);
    const { cards, ...record } = column;
    return { column: { ...record, total_card_count: cards.length } };
  } catch {
    return mutationResult(action, () => ({ column: { ...normalizeColumn(response?.column), tag_name: tagName }, warnings: ["Column saved, but the board could not be re-read; tag_name reflects the requested value and card count is unavailable"] }));
  }
}

export const createBoardColumnTool = defineTool({
  name: "discourse_create_board_column", title: "Create Board Column",
  description: "Append a Discourse Boards column (use discourse_move_board_column to reposition). Rules swap topic column tags, recategorize, assign/unassign ('nobody') and open/close when topics are added/moved. Tagged columns auto-collect matching topics on constrained boards; moving topic cards into them applies the tag. Missing tags require allow_tag_creation. Colors accept 3/6 hex digits with optional '#'. Re-reads the board for authoritative tag and card count, or warns on fallback.",
  schema: createBoardColumnInputSchema, outputSchema: createBoardColumnOutputSchema, availability: "writes_enabled", toolsets: ["boards"], annotations: createAnnotations,
  handler: boardHandler(createBoardColumnInputSchema, createBoardColumnOutputSchema, "Create board column", true, async (values, extra, { base, client }) => {
    await guardTags(client, values.tag_name ? [values.tag_name] : [], values.allow_tag_creation, extra.signal);
    const response = await mutate(base, values.board_id, "Create board column", () => client.postNoRetry(boardPath(values.board_id, "/columns"), { column: pickProvided(values, columnMutableKeys) }, { signal: extra.signal })) as any;
    const column = mutationResult("Create board column", () => normalizeColumn(response?.column));
    return rereadColumn(client, base, values.board_id, column.id, response, values.tag_name ?? null, "Create board column", extra.signal);
  }),
});

export const updateBoardColumnTool = defineTool({
  name: "discourse_update_board_column", title: "Update Board Column",
  description: "Safely update column settings by reading fresh state and merging omitted fields before sending the FULL replacement required upstream. Explicit null clears a nullable rule/icon/color/tag. A column tag hidden from the caller cannot be seen and will be cleared by an update. Missing new tags require allow_tag_creation. Topic cards entering this column apply tag/category/assignment/status rules; constrained boards auto-sync tagged columns. Re-reads the board for authoritative tag and count.",
  schema: updateBoardColumnInputSchema, outputSchema: updateBoardColumnOutputSchema, availability: "writes_enabled", toolsets: ["boards"], annotations: destructiveAnnotations,
  handler: boardHandler(updateBoardColumnInputSchema, updateBoardColumnOutputSchema, "Update board column", true, async (values, extra, { base, client }) => {
    const snapshot = await fetchBoard(client, base, values.board_id, extra.signal);
    requireBoardManageable(snapshot.board);
    const { cards: _cards, ...previous } = findColumn(snapshot, values.column_id);
    const current = pickProvided(previous, columnMutableKeys);
    const merged = { ...current, ...pickProvided(values, columnMutableKeys) };
    if (JSON.stringify(current) === JSON.stringify(merged)) noOp();
    await guardTags(client, values.tag_name ? [values.tag_name] : [], values.allow_tag_creation, extra.signal, previous.tag_name ? [previous.tag_name] : []);
    const response = await mutate(base, values.board_id, "Update board column", () => client.putNoRetry(boardPath(values.board_id, `/columns/${values.column_id}`), { column: merged }, { signal: extra.signal })) as any;
    return { ...await rereadColumn(client, base, values.board_id, values.column_id, response, merged.tag_name as string | null, "Update board column", extra.signal), previous };
  }),
});

export const moveBoardColumnTool = defineTool({
  name: "discourse_move_board_column", title: "Move Board Column",
  description: "Reorder a Discourse Boards column to a zero-based position with sequential neighbour swaps. Each swap is rate-limited and never automatically retried. A mid-move failure reports partial_move and the completed swaps/last known order; uncertain 5xx/network outcomes require re-reading before retrying. Requires a manageable non-archived board.",
  schema: moveBoardColumnInputSchema, outputSchema: moveBoardColumnOutputSchema, availability: "writes_enabled", toolsets: ["boards"], annotations: createAnnotations,
  handler: boardHandler(moveBoardColumnInputSchema, moveBoardColumnOutputSchema, "Move board column", true, async (values, extra, { base, client }) => {
    const snapshot = await fetchBoard(client, base, values.board_id, extra.signal);
    requireBoardManageable(snapshot.board);
    findColumn(snapshot, values.column_id);
    let order = [...snapshot.columns].sort((a, b) => a.position - b.position || a.id - b.id).map((column) => column.id);
    const from = order.indexOf(values.column_id);
    if (values.to_position >= order.length) fail("invalid_position", "to_position is outside the board's column range", { column_count: order.length });
    if (values.to_position === from) noOp();
    const direction = values.to_position > from ? 1 : -1;
    let completed = 0;
    for (let index = 0; index < Math.abs(values.to_position - from); index++) {
      try {
        const response = await mutate(base, values.board_id, "Move board column", () => client.postNoRetry(boardPath(values.board_id, "/move-column"), { column_id: values.column_id, direction }, { signal: extra.signal }), { completed_swaps: completed, column_order: order });
        try {
          order = z.object({ column_order: z.array(z.number().int().positive()) }).parse(response).column_order;
        } catch {
          throw new BoardToolError(outcomeUnknown("Move board column", values.board_id, "Discourse accepted the swap but returned an unreadable acknowledgement", { completed_swaps: completed + 1, column_order: order }));
        }
        completed++;
      } catch (error) {
        if (completed > 0) {
          const mappedResponse = boardsError("Move board column", error);
          const mapped = JSON.parse(mappedResponse.content[0].text);
          if (mapped.code === "outcome_unknown") throw error;
          fail("partial_move", "Column move stopped after some successful swaps; re-read the board before retrying", { completed_swaps: completed, column_order: order, upstream_error: mapped });
        }
        throw error;
      }
    }
    return { column_id: values.column_id, from_position: from, to_position: values.to_position, column_order: order };
  }),
});

export const clearBoardColumnTool = defineTool({
  name: "discourse_clear_board_column", title: "Clear Board Column",
  description: "Remove floaters and visible topic cards from a writable non-archived column with confirm_clear: true and optional expected_card_count. Floaters are lost. Topics are never deleted; Discourse removes the column tag from topics when the caller can edit them. Counts reflect the fresh visible snapshot, not hidden cards.",
  schema: clearBoardColumnInputSchema, outputSchema: clearBoardColumnOutputSchema, availability: "writes_enabled", toolsets: ["boards"], annotations: destructiveAnnotations,
  handler: boardHandler(clearBoardColumnInputSchema, clearBoardColumnOutputSchema, "Clear board column", true, async (values, extra, { base, client }) => {
    const snapshot = await fetchBoard(client, base, values.board_id, extra.signal);
    requireBoardWritable(snapshot.board);
    const column = findColumn(snapshot, values.column_id);
    if (values.expected_card_count !== undefined && values.expected_card_count !== column.cards.length) fail("state_conflict", "Column card count changed; review before clearing", { current_card_count: column.cards.length });
    const topicCount = column.cards.filter((card) => card.type === "topic").length;
    await mutate(base, values.board_id, "Clear board column", () => client.deleteNoRetry(boardPath(values.board_id, `/columns/${column.id}/cards`), undefined, { signal: extra.signal }));
    return { cleared: true as const, column: { id: column.id, title: column.title, tag_name: column.tag_name }, cards_removed: column.cards.length, topic_cards_removed: topicCount, floater_cards_removed: column.cards.length - topicCount, topic_tag_removed: column.tag_name };
  }),
});

export const deleteBoardColumnTool = defineTool({
  name: "discourse_delete_board_column", title: "Delete Board Column",
  description: "Permanently delete a column and all its cards. Requires confirm_delete: true and the exact current column_title. Floaters are lost; topics and their tags are untouched (unlike clearing a column). Requires a manageable non-archived board; counts are from the fresh visible snapshot.",
  schema: deleteBoardColumnInputSchema, outputSchema: deleteBoardColumnOutputSchema, availability: "writes_enabled", toolsets: ["boards"], annotations: destructiveAnnotations,
  handler: boardHandler(deleteBoardColumnInputSchema, deleteBoardColumnOutputSchema, "Delete board column", true, async (values, extra, { base, client }) => {
    const snapshot = await fetchBoard(client, base, values.board_id, extra.signal);
    requireBoardManageable(snapshot.board);
    const { cards, ...column } = findColumn(snapshot, values.column_id);
    if (values.column_title !== column.title) fail("identity_mismatch", "Exact current column title does not match", { current_title: column.title });
    const topics = cards.filter((card) => card.type === "topic").length;
    await mutate(base, values.board_id, "Delete board column", () => client.deleteNoRetry(boardPath(values.board_id, `/columns/${column.id}`), undefined, { signal: extra.signal }));
    return { deleted: true as const, column, cards_deleted: cards.length, topic_cards_deleted: topics, floater_cards_deleted: cards.length - topics };
  }),
});
