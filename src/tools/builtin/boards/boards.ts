import { z } from "zod";
import { HttpError } from "../../../http/client.js";
import { defineTool } from "../../definition.js";
import { BoardToolError, boardHandler, boardMutableKeys, boardPath, boardsPath, createAnnotations, createBoardRecovery, destructiveAnnotations, fail, fetchBoard, guardTags, message, mutate, mutationResult, noOp, outcomeUnknown, pickProvided, requireBoardManageable, resolveTagNames, sameSet } from "./common.js";
import { canonicalAcl, resolveAcl, resolveOwners, wireAcl, type PrincipalCache } from "./acl.js";
import { normalizeBoard, normalizeBoardDetail } from "./projections.js";
import { createBoardInputSchema, createBoardOutputSchema, updateBoardInputSchema, updateBoardOutputSchema, setBoardArchivedInputSchema, setBoardArchivedOutputSchema, deleteBoardInputSchema, deleteBoardOutputSchema } from "./schemas.js";

const createCauses = ["slug already in use", "unknown category id", "tag that cannot be resolved/created", "invalid ACL entry (unknown user/group, banned entry)", "additional owners can only be requested by admins at creation"];
const updateCauses = ["owner change not permitted", "invalid ACL entry", "unknown category", "slug in use", "tag cannot be resolved/created"];
export const createBoardTool = defineTool({
  name: "discourse_create_board", title: "Create Board",
  description: 'Create a Discourse Boards kanban board; requires membership in boards_manage_board_allowed_groups. Explicit acl is required, e.g. [{"type":"group","name":"logged_in_users","permission":"view"},{"type":"group","name":"staff","permission":"edit"}]; [] permits only owners and mandatory admins-manage. Everyone is banned, anonymous_users can only view. The acting API username always becomes an owner; owners ADDS owners (admins only at creation), it does not replace the creator. owners_requested records the requested additions; board.owners contains the effective owners. Board category/tag constraints enable topic auto-sync (max 200 per tagged column); untagged columns are manual. Missing board/column tags require allow_tag_creation. Set column colors afterwards with discourse_update_board_column; creation does not support them.',
  schema: createBoardInputSchema, outputSchema: createBoardOutputSchema, availability: "writes_enabled", toolsets: ["boards"], annotations: createAnnotations,
  handler: boardHandler(createBoardInputSchema, createBoardOutputSchema, "Create board", true, async (values, extra, { base, client }) => {
    const principals: PrincipalCache = new Map();
    const acl = await resolveAcl(client, values.acl, extra.signal, principals);
    const owners = values.owners ? await resolveOwners(client, values.owners, extra.signal, principals) : undefined;
    await guardTags(client, [...(values.tag_names ?? []), ...(values.columns ?? []).flatMap((column) => column.tag_name ? [column.tag_name] : [])], values.allow_tag_creation, extra.signal);
    const board = { ...pickProvided(values, boardMutableKeys), acl: wireAcl(acl), ...(owners ? { owner_user_ids: owners.map((owner) => owner.id) } : {}), columns: values.columns ?? [] };
    const recoveryHint = createBoardRecovery(values.name);
    const response = await mutate(base, undefined, "Create board", () => client.postNoRetry(boardsPath, { board }, { signal: extra.signal }), {}, { possibleCauses: createCauses, recoveryHint }) as any;
    return mutationResult("Create board", () => ({ board: normalizeBoard(response?.board, base), acl_applied: acl, ...(owners ? { owners_requested: owners } : {}) }), recoveryHint);
  }, (values) => createBoardRecovery(values.name)),
});

export const updateBoardTool = defineTool({
  name: "discourse_update_board", title: "Update Board",
  description: "Partially update a manageable non-archived Discourse Boards board; only provided keys are sent. Changing constraints removes non-matching topic cards (topics remain) and may auto-sync matching topics: removal needs confirm_card_removal after a canonical-tag preview. If all resulting tags are new, every topic card (including hidden cards) is removed and explicit confirmation is required without a preview. On constrained boards ANY board update may prune stale non-matching topic cards, reported in cards_removed_count. acl replaces all non-owner entries (admins always manage); changed ACLs/owners need confirm_access_change. Owner changes require can_manage_acl_owner; unchanged owners are omitted from the PUT. Missing new tags require allow_tag_creation. can_manage is authoritative, not merely a manage ACL.",
  schema: updateBoardInputSchema, outputSchema: updateBoardOutputSchema, availability: "writes_enabled", toolsets: ["boards"], annotations: destructiveAnnotations,
  handler: boardHandler(updateBoardInputSchema, updateBoardOutputSchema, "Update board", true, async (values, extra, { base, client }) => {
    const snapshot = await fetchBoard(client, base, values.board_id, extra.signal);
    const current = snapshot.board;
    requireBoardManageable(current);
    const principals: PrincipalCache = new Map();
    const nextCategories = values.category_ids ?? current.category_ids;
    const nextTags = values.tag_names ?? current.tag_names;
    const constraintsChanged = (values.category_ids !== undefined && !sameSet(nextCategories, current.category_ids)) || (values.tag_names !== undefined && !sameSet(nextTags, current.tag_names, true));
    const resolvedTags = constraintsChanged || values.tag_names !== undefined ? await resolveTagNames(client, nextTags, extra.signal) : undefined;
    const canonicalTags = nextTags.map((name) => resolvedTags?.canonical.get(name.toLocaleLowerCase("en-US")) ?? name);
    if (constraintsChanged) {
      const existingTags = [...resolvedTags!.canonical.values()];
      if (nextTags.length && !existingTags.length) {
        if (values.confirm_card_removal !== true) {
          const visibleTopicCards = snapshot.columns.flatMap((column) => column.cards).filter((card) => card.type === "topic").length;
          fail("confirmation_required", "All resulting tags are new: every topic card will be removed, including hidden topic cards. Retry with confirm_card_removal: true after review", { visible_topic_cards: visibleTopicCards });
        }
      } else {
        const preview = z.object({ cards_to_remove: z.number().int().nonnegative() }).parse(await client.post(boardPath(values.board_id, "/constraint-preview"), { category_ids: nextCategories, tag_names: existingTags }, { signal: extra.signal }));
        if (preview.cards_to_remove > 0 && values.confirm_card_removal !== true) fail("confirmation_required", "Constraint changes remove topic cards; review and retry with confirm_card_removal: true", { cards_to_remove: preview.cards_to_remove });
      }
    }
    const acl = values.acl !== undefined ? await resolveAcl(client, values.acl, extra.signal, principals) : undefined;
    const aclChanged = acl !== undefined && !sameSet(canonicalAcl(acl), canonicalAcl(current.acl ?? []));
    if (aclChanged && values.confirm_access_change !== true) fail("confirmation_required", "ACL replacement changes access; retry with confirm_access_change: true", { current_acl: current.acl, requested_acl: acl });
    const owners = values.owners !== undefined ? await resolveOwners(client, values.owners, extra.signal, principals) : undefined;
    const ownersChanged = owners !== undefined && !sameSet(owners.map((owner) => owner.id), current.owners.map((owner) => owner.id));
    if (ownersChanged && !current.can_manage_acl_owner) fail("insufficient_permission", "Only admins or current owners may change board owners (can_manage_acl_owner is false)");
    if (ownersChanged && values.confirm_access_change !== true) fail("confirmation_required", "Owner replacement changes access; retry with confirm_access_change: true", { current_owners: current.owners, requested_owners: owners });
    await guardTags(client, values.tag_names ?? [], values.allow_tag_creation, extra.signal, current.tag_names, resolvedTags);
    const changes = boardMutableKeys.some((key) => values[key] !== undefined && (key === "category_ids" ? !sameSet(values.category_ids!, current.category_ids) : key === "tag_names" ? !sameSet(values.tag_names!, current.tag_names, true) : values[key] !== current[key]));
    if (!changes && !aclChanged && !ownersChanged) noOp();
    const board = { ...pickProvided(values, boardMutableKeys), ...(values.tag_names !== undefined ? { tag_names: canonicalTags } : {}), ...(acl ? { acl: wireAcl(acl) } : {}), ...(ownersChanged ? { owner_user_ids: owners!.map((owner) => owner.id) } : {}) };
    const response = await mutate(base, values.board_id, "Update board", () => client.putNoRetry(boardPath(values.board_id), { board }, { signal: extra.signal }), {}, { possibleCauses: updateCauses }) as any;
    return mutationResult("Update board", () => ({ board: normalizeBoardDetail(response?.board, base), cards_removed_count: response?.cards_removed_count ?? 0 }));
  }),
});

export const setBoardArchivedTool = defineTool({
  name: "discourse_set_board_archived", title: "Set Board Archived",
  description: "Archive/unarchive Discourse Boards using manage ACL permission (owner counts). Archiving makes a board read-only, stops topic sync, and renames its slug to <slug>-archived-YYYYMMDD. Unarchiving restores the original slug unless taken; old_slug_used requires a new slug. slug is accepted only when unarchiving. No automatic mutation retries.",
  schema: setBoardArchivedInputSchema, outputSchema: setBoardArchivedOutputSchema, availability: "writes_enabled", toolsets: ["boards"], annotations: createAnnotations,
  handler: boardHandler(setBoardArchivedInputSchema, setBoardArchivedOutputSchema, "Set board archived", true, async (values, extra, { base, client }) => {
    const { board } = await fetchBoard(client, base, values.board_id, extra.signal);
    if (board.archived === values.archived) noOp();
    if (values.archived ? !board.can_archive : !board.can_unarchive) fail("insufficient_permission", "Archiving/unarchiving requires manage ACL permission (owners count)");
    if (!values.archived && board.old_slug_used && !values.slug) fail("slug_required", "Original slug is taken; provide slug to unarchive");
    const response = await mutate(base, values.board_id, "Set board archived", () => client.postNoRetry(boardPath(values.board_id, values.archived ? "/archive" : "/unarchive"), values.archived ? {} : pickProvided(values, ["slug"]), { signal: extra.signal })) as any;
    return mutationResult("Set board archived", () => ({ board: normalizeBoard(response?.board, base) }));
  }),
});

export const deleteBoardTool = defineTool({
  name: "discourse_delete_board", title: "Delete Board",
  description: "Permanently delete a Discourse Boards board and all columns/cards. Floaters are lost; topics are never deleted. Requires a manageable non-archived board, confirm_delete: true, and exact current name. Verifies absence with a fresh GET; an unverifiable result returns outcome_unknown and must not be blindly retried.",
  schema: deleteBoardInputSchema, outputSchema: deleteBoardOutputSchema, availability: "writes_enabled", toolsets: ["boards"], annotations: destructiveAnnotations,
  handler: boardHandler(deleteBoardInputSchema, deleteBoardOutputSchema, "Delete board", true, async (values, extra, { base, client }) => {
    const snapshot = await fetchBoard(client, base, values.board_id, extra.signal);
    const { board } = snapshot;
    if (values.name !== board.name) fail("identity_mismatch", "Exact current board name does not match", { current_name: board.name });
    requireBoardManageable(board);
    const cards = snapshot.columns.flatMap((column) => column.cards);
    const topics = cards.filter((card) => card.type === "topic").length;
    await mutate(base, values.board_id, "Delete board", () => client.deleteNoRetry(boardPath(values.board_id), undefined, { signal: extra.signal }));
    try {
      await client.get(boardPath(values.board_id), { signal: extra.signal });
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) return { deleted: true as const, board: { id: board.id, name: board.name, slug: board.slug }, impact: { columns: snapshot.columns.length, visible_cards: cards.length, topic_cards: topics, floater_cards: cards.length - topics } };
      throw new BoardToolError(outcomeUnknown("Delete board", values.board_id, message(error)));
    }
    throw new BoardToolError(outcomeUnknown("Delete board", values.board_id, "board still readable after delete"));
  }),
});
