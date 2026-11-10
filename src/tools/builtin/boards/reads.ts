import { z } from "zod";
import { defineTool } from "../../definition.js";
import { boardHandler, boardsPath, fail, fetchBoard, permissions, readAnnotations } from "./common.js";
import { normalizeAvailable, normalizeBoard } from "./projections.js";
import { listBoardsInputSchema, listBoardsOutputSchema, getBoardInputSchema, getBoardOutputSchema, listTopicBoardsInputSchema, listTopicBoardsOutputSchema } from "./schemas.js";

export const listBoardsTool = defineTool({
  name: "discourse_list_boards", title: "List Boards",
  description: "Discover boards from the Discourse Boards (kanban) plugin (boards_enabled required). Anonymous reads work for public boards. The boards ACL includes boards owned by the caller. can_manage is authoritative: a manage ACL alone is insufficient without manager-group membership unless the caller is an owner. Filters archived boards and name/slug queries locally, preserving upstream name order.",
  schema: listBoardsInputSchema, outputSchema: listBoardsOutputSchema, availability: "always", toolsets: ["boards"], annotations: readAnnotations(),
  handler: boardHandler(listBoardsInputSchema, listBoardsOutputSchema, "List boards", false, async (values, extra, { base, client }) => {
    const body = await client.get(`${boardsPath}?allowed_permissions=${permissions(values.min_permission)}`, { signal: extra.signal }) as any;
    const all = z.array(z.any()).parse(body?.boards).map((board) => normalizeBoard(board, base));
    const query = values.query?.toLocaleLowerCase("en-US");
    const boards = all.filter((board) => (values.include_archived || !board.archived) && (!query || board.name.toLocaleLowerCase("en-US").includes(query) || board.slug.toLocaleLowerCase("en-US").includes(query)));
    return { boards, meta: { returned: boards.length, total: all.length, min_permission: values.min_permission, include_archived: values.include_archived, ...(values.query ? { query: values.query } : {}) } };
  }),
});

export const getBoardTool = defineTool({
  name: "discourse_get_board", title: "Get Board",
  description: "Read a Discourse Boards board with ordered columns, filtered cards, bounded floater notes, and truthful truncation counts. meta.total_cards counts selected columns only; missing_card_ids means absent from the entire visible board, not merely excluded by column filters. ACL is present only for managers. This GET is not a pure read: upstream backfill-sync may create/remove auto-synced topic cards, and logs a board-viewed history row per authenticated user per day. Anonymous public-board reads are supported.",
  schema: getBoardInputSchema, outputSchema: getBoardOutputSchema, availability: "always", toolsets: ["boards"], annotations: readAnnotations(),
  handler: boardHandler(getBoardInputSchema, getBoardOutputSchema, "Get board", false, async (values, extra, { base, client }) => {
    const snapshot = await fetchBoard(client, base, values.board_id, extra.signal);
    if (values.column_ids?.some((id) => !snapshot.columns.some((column) => column.id === id))) {
      fail("unknown_column_ids", "Unknown requested column IDs", { available_column_ids: snapshot.columns.map((column) => column.id) });
    }
    const selected = snapshot.columns.filter((column) => !values.column_ids || values.column_ids.includes(column.id));
    const columns = selected.map(({ cards: all, ...column }) => {
      const matching = all.filter((card) => (!values.card_ids || values.card_ids.includes(card.id)) && (!values.card_query || (card.title ?? "").toLocaleLowerCase("en-US").includes(values.card_query.toLocaleLowerCase("en-US"))));
      const cards = matching.slice(0, values.max_cards_per_column).map((card) => card.type === "floater" && card.notes != null && card.notes.length > values.notes_max_chars
        ? { ...card, notes: card.notes.slice(0, values.notes_max_chars), notes_truncated: true } : card);
      return { ...column, total_card_count: all.length, card_count: matching.length, truncated: matching.length > cards.length, cards };
    });
    const total = columns.reduce((sum, column) => sum + column.total_card_count, 0);
    const matching = columns.reduce((sum, column) => sum + column.card_count, 0);
    const returned = columns.reduce((sum, column) => sum + column.cards.length, 0);
    const visibleIds = new Set(snapshot.columns.flatMap((column) => column.cards.map((card) => card.id)));
    return { board: snapshot.board, columns, meta: { total_cards: total, matching_cards: matching, returned_cards: returned, truncated: matching > returned, max_cards_per_column: values.max_cards_per_column,
      ...(values.card_ids ? { missing_card_ids: values.card_ids.filter((id) => !visibleIds.has(id)) } : {}) } };
  }),
});

export const listTopicBoardsTool = defineTool({
  name: "discourse_list_topic_boards", title: "List Topic Boards",
  description: "Discover open Discourse Boards boards and columns where a topic already has cards and where it can be added. Use min_permission: edit for boards the caller can add cards to. Archived boards are excluded upstream; missing topic membership flags normalize to false.",
  schema: listTopicBoardsInputSchema, outputSchema: listTopicBoardsOutputSchema, availability: "always", toolsets: ["boards"], annotations: readAnnotations(),
  handler: boardHandler(listTopicBoardsInputSchema, listTopicBoardsOutputSchema, "List topic boards", false, async (values, extra, { base, client }) => {
    const body = await client.get(`/boards/api/boards/available.json?topic_id=${values.topic_id}&allowed_permissions=${permissions(values.min_permission)}`, { signal: extra.signal }) as any;
    const boards = z.array(z.any()).parse(body?.boards).map((board) => normalizeAvailable(board, base));
    return { topic_id: values.topic_id, boards, meta: { returned: boards.length, min_permission: values.min_permission } };
  }),
});
