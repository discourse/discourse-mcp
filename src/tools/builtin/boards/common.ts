import { z } from "zod";
import { HttpError, type HttpClient } from "../../../http/client.js";
import type { StructuredToolResult, ToolExtra } from "../../definition.js";
import type { ToolContext, ToolRegistrationOptions } from "../../types.js";
import { requireWriteAccess } from "../../../util/access.js";
import { isZodError, jsonError, structuredJsonResponse, withRateLimit, zodError } from "../../../util/json_response.js";
import { readAnnotations } from "../common/helpers.js";
import { normalizeBoardDetail, normalizeCard, normalizeColumn } from "./projections.js";
import type { BoardDetail, CardRecord, ColumnRecord } from "./schemas.js";

export { readAnnotations };
export const createAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } as const;
export const destructiveAnnotations = { ...createAnnotations, destructiveHint: true } as const;
export const boardsPath = "/boards/api/boards.json";
export const boardPath = (id: number, suffix = "") => `/boards/api/boards/${id}${suffix}.json`;
export const permissions = (minimum: "view" | "edit" | "manage") => ({ view: "view,edit,manage", edit: "edit,manage", manage: "manage" })[minimum];
export const message = (error: unknown) => error instanceof Error ? error.message : String(error);

/** A local rejection already has its final unstructured MCP error. */
export class BoardToolError extends Error {
  constructor(readonly response: ReturnType<typeof jsonError>) { super(JSON.parse(response.content[0].text).error); }
}
export function fail(code: string, text: string, details: Record<string, unknown> = {}): never {
  throw new BoardToolError(jsonError(text, { code, ...details }));
}
export function noOp(): never { return fail("no_op", "Requested values already match the current board state"); }

export function boardsError(action: string, error: unknown, opts: { possibleCauses?: string[] } = {}) {
  if (error instanceof BoardToolError) return error.response;
  if (isZodError(error)) return jsonError(`${action}: malformed upstream response`, { code: "malformed_upstream_response" });
  if (!(error instanceof HttpError)) return jsonError(`${action}: ${message(error)}`, { code: "request_failed" });
  const body = error.body as any;
  const errors = Array.isArray(body?.errors) ? body.errors.filter((item: unknown) => typeof item === "string").slice(0, 20) : [];
  const codes: Record<number, string> = { 400: "invalid_parameters", 401: "authentication_required", 403: "insufficient_permission", 404: "boards_unavailable_or_not_found", 409: "conflict", 422: errors.length ? "rejected" : "rejected_without_details", 429: "rate_limited" };
  const details: Record<string, unknown> = { code: codes[error.status] ?? "upstream_error", status: error.status };
  if (errors.length) details.errors = errors;
  if (typeof body?.error_type === "string") details.error_type = body.error_type;
  if (error.status === 404) details.possible_causes = ["boards plugin disabled (boards_enabled site setting)", "board, column, card, or topic does not exist or is not visible to this user"];
  if (error.status === 403) details.possible_causes = [
    "boards plugin disabled (boards_enabled site setting)",
    "board ACL lacks the needed permission (edit for cards and clearing columns, manage for board/column settings)",
    "board is archived (read-only)", "user is not in boards_manage_board_allowed_groups (creating/managing boards)",
    "user cannot edit the topic that a column rule would change", "user cannot assign (discourse-assign)",
    "a scoped API key or read-only User API key cannot call this route",
  ];
  if (error.status === 422 && !errors.length && opts.possibleCauses) details.possible_causes = opts.possibleCauses;
  if (error.status === 429) {
    details.retryable = true;
    const serialized = typeof error.body === "string" ? error.body : JSON.stringify(error.body ?? "");
    const match = serialized.match(/(?:wait|retry(?: after)?)[^0-9]{0,20}(\d+)\s*(?:seconds?|secs?)/i);
    if (match) details.retry_after_seconds = Number(match[1]);
  }
  return jsonError(`${action}: ${error.message}`, details);
}
export function createBoardRecovery(name: string) {
  return `check discourse_list_boards with ${JSON.stringify({ query: name, include_archived: true })} before creating again`;
}
export function outcomeUnknown(action: string, boardId: number | undefined, detail: string, extras: Record<string, unknown> = {}, recoveryHint = "re-read the board with discourse_get_board before retrying") {
  return jsonError(`${action}: the request may have been applied but the outcome could not be confirmed; ${recoveryHint}`, {
    code: "outcome_unknown", retryable: false, detail: detail.slice(0, 300), ...(boardId !== undefined ? { board_id: boardId } : {}), ...extras,
  });
}
/** Only wrap normalization after an accepted mutation, never input parsing or preflights. */
export function mutationResult<T>(action: string, normalize: () => T, recoveryHint = "re-read the board first (discourse_get_board)"): T {
  try { return normalize(); }
  catch {
    throw new BoardToolError(jsonError(`${action}: Discourse accepted the request but returned an unexpected response; do not retry blindly — ${recoveryHint}`, {
      code: "malformed_upstream_response", mutation_applied: true, retryable: false,
    }));
  }
}
export async function mutate<T>(base: string, boardId: number | undefined, action: string, op: () => Promise<T>, extras: Record<string, unknown> = {}, opts: { possibleCauses?: string[]; recoveryHint?: string } = {}): Promise<T> {
  try { return await withRateLimit(`boards:${base}`, op, 1000); }
  catch (error) {
    throw new BoardToolError(!(error instanceof HttpError) || error.status >= 500
      ? outcomeUnknown(action, boardId, message(error), extras, opts.recoveryHint)
      : boardsError(action, error, opts));
  }
}

/** Input validation is deliberately isolated from validation of upstream records. */
export function boardHandler<S extends z.ZodObject, O extends z.ZodObject>(
  schema: S, outputSchema: O, action: string, write: boolean,
  op: (values: z.output<S>, extra: ToolExtra, site: { base: string; client: HttpClient }) => Promise<z.input<O>>,
  recoveryHint?: (values: z.output<S>) => string,
) {
  return async (input: z.output<S>, extra: ToolExtra, ctx: ToolContext, opts: ToolRegistrationOptions): Promise<StructuredToolResult<z.output<O>>> => {
    let values: z.output<S>;
    try { values = schema.parse(input); }
    catch (error) { if (isZodError(error)) return zodError(error); throw error; }
    if (write) {
      const denied = requireWriteAccess(ctx.siteState, opts.allowWrites);
      if (denied) return denied;
    }
    try {
      const result = await op(values, extra, ctx.siteState.ensureSelectedSite());
      const normalized = write ? mutationResult(action, () => outputSchema.parse(result), recoveryHint?.(values)) : outputSchema.parse(result);
      return structuredJsonResponse(normalized);
    } catch (error) { return boardsError(action, error); }
  };
}

export interface BoardSnapshot { board: BoardDetail; columns: Array<ColumnRecord & { cards: CardRecord[] }> }
export async function fetchBoard(client: HttpClient, base: string, id: number, signal?: AbortSignal): Promise<BoardSnapshot> {
  const body = await client.get(boardPath(id), { signal }) as any;
  const board = normalizeBoardDetail(body?.board, base);
  const columns = z.array(z.any()).parse(body?.columns).map((column) => ({
    ...normalizeColumn(column), cards: z.array(z.any()).parse(column?.cards).map((card) => normalizeCard(card, base, board.id, board.slug)),
  }));
  return { board, columns };
}
export function requireBoardWritable(board: BoardDetail) {
  if (board.archived) fail("board_archived", "Board is archived and read-only; unarchive before modifying it");
  if (!board.can_write) fail("board_not_writable", "Board is not writable by this user; edit ACL permission is required");
}
export function requireBoardManageable(board: BoardDetail) {
  if (board.archived) fail("board_archived", "Board is archived; unarchive before managing or deleting it");
  if (!board.can_manage) fail("board_not_manageable", "Board is not manageable by this user; can_manage is authoritative");
}
export function findColumn(snapshot: BoardSnapshot, id: number) {
  const column = snapshot.columns.find((column) => column.id === id);
  if (!column) fail("column_not_found", "Column not found on this board", { available_columns: snapshot.columns.map(({ id, title }) => ({ id, title })) });
  return column;
}
export function findCard(snapshot: BoardSnapshot, id: number) {
  for (const column of snapshot.columns) {
    const card = column.cards.find((card) => card.id === id);
    if (card) return { card, column };
  }
  return fail("card_not_found", "Card not found on this board");
}
export function sameSet(left: readonly (string | number)[], right: readonly (string | number)[], caseInsensitive = false) {
  const canonical = (values: readonly (string | number)[]) => [...new Set(values.map((value) => caseInsensitive && typeof value === "string" ? value.toLocaleLowerCase("en-US") : value))].sort().map(String);
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}
export interface ResolvedTagNames { canonical: Map<string, string>; missing: string[] }
/** Search includes visible unused tags that the general tags inventory hides from non-admins. */
export async function resolveTagNames(client: HttpClient, names: string[], signal?: AbortSignal): Promise<ResolvedTagNames> {
  const distinct = new Map<string, string>();
  for (const name of names) {
    const key = name.toLocaleLowerCase("en-US");
    if (!distinct.has(key)) distinct.set(key, name);
  }
  const canonical = new Map<string, string>();
  const missing: string[] = [];
  for (const [key, name] of distinct) {
    const body = z.object({ results: z.array(z.object({ name: z.string().min(1) })) }).parse(
      await client.get(`/tags/filter/search.json?q=${encodeURIComponent(name)}&limit=5`, { signal }),
    );
    const exact = body.results.find((tag) => tag.name.toLocaleLowerCase("en-US") === key);
    if (exact) canonical.set(key, exact.name);
    else missing.push(name);
  }
  return { canonical, missing };
}
export async function guardTags(client: HttpClient, names: string[], allowCreation: boolean, signal?: AbortSignal, existingNames: string[] = [], resolved?: ResolvedTagNames) {
  const existing = new Set(existingNames.map((name) => name.toLocaleLowerCase("en-US")));
  const distinct = new Map(names.filter((name) => !existing.has(name.toLocaleLowerCase("en-US"))).map((name) => [name.toLocaleLowerCase("en-US"), name]));
  if (!distinct.size) return;
  const resolution = resolved ?? await resolveTagNames(client, [...distinct.values()], signal);
  const missing = resolution.missing.filter((name) => distinct.has(name.toLocaleLowerCase("en-US")));
  if (missing.length && allowCreation !== true) {
    fail("tag_creation_not_allowed", "Missing tags require allow_tag_creation: true before creating persistent tags", { missing_tags: missing });
  }
}
export function pickProvided<T extends object>(input: T, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(keys.filter((key) => (input as any)[key] !== undefined).map((key) => [key, (input as any)[key]]));
}
export const columnMutableKeys = ["title", "icon", "color", "default_sort", "tag_name", "move_to_category_id", "move_to_assigned", "move_to_status"] as const;
export const boardMutableKeys = ["name", "slug", "category_ids", "tag_names", "card_style", "show_tags", "show_topic_thumbnail", "require_confirmation"] as const;
