import { HttpError } from "../../../http/client.js";
import { defineTool } from "../../definition.js";
import { isZodError, jsonError, structuredJsonResponse, zodError } from "../../../util/json_response.js";
import {
  completeTagGroupBody,
  conflictError,
  createAnnotations,
  currentSelectors,
  deleteAnnotations,
  getTagGroup,
  isNotFound,
  listTagGroups,
  normalizeTagGroup,
  outcomeUnknown,
  replacementAnnotations,
  requireTagGroupWrite,
  resolveTagSelectors,
  samePermissions,
  selectorsConflict,
  tagGroupError,
  tagGroupMutation,
  unwrapTagGroup,
  validatePermissionGroups,
} from "./common.js";
import {
  createTagGroupInputSchema,
  deleteTagGroupInputSchema,
  deleteTagGroupOutputSchema,
  tagGroupOutputSchema,
  updateTagGroupInputSchema,
  type Permissions,
  type TagGroupRecord,
  type TagSelector,
} from "./schemas.js";

function folded(value: string): string {
  return value.toLocaleLowerCase("en-US");
}

function mutableUpdateRequested(input: Record<string, unknown>): boolean {
  return ["name", "tags", "parent_tag", "one_per_topic", "permissions"].some((key) => Object.prototype.hasOwnProperty.call(input, key));
}

function syntheticPermissionWarning(group: TagGroupRecord): string | undefined {
  const entries = Object.entries(group.permissions);
  return entries.length === 1 && entries[0][0] === "0" && entries[0][1] === 1
    ? "Current everyone/full permissions may be serializer-synthesized from a legacy empty permission-row set; this complete-state update materializes that policy upstream."
    : undefined;
}

export const createTagGroupTool = defineTool({
  name: "discourse_create_tag_group",
  title: "Create Tag Group",
  description: "Create a tag group with explicit complete numeric permissions (1=full, 3=readonly), nonempty members, optional parent, and one-per-topic policy. New tag names require allow_tag_creation=true because they create persistent tags and trigger normal indexing/plugin hooks. Duplicate-name and ID checks are advisory; upstream staff authority, tagging_enabled, and constraints remain authoritative.",
  schema: createTagGroupInputSchema,
  outputSchema: tagGroupOutputSchema,
  availability: "writes_enabled",
  toolsets: ["tag_groups"],
  annotations: createAnnotations,
  handler: async (input, extra, ctx, opts) => {
    try {
      const values = createTagGroupInputSchema.parse(input);
      const denied = requireTagGroupWrite(ctx.siteState, opts);
      if (denied) return denied;
      const { base, client } = ctx.siteState.ensureSelectedSite();

      const existing = await listTagGroups(client, extra.signal);
      if (existing.some((group) => folded(group.name) === folded(values.name))) {
        return jsonError("A tag group with this name already exists (case-insensitive advisory preflight)", {
          code: "duplicate_name",
        });
      }

      const combined = await resolveTagSelectors(
        client,
        [...values.tags, ...(values.parent_tag ? [values.parent_tag] : [])],
        values.allow_tag_creation,
        extra.signal,
        existing.flatMap((group) => [...group.tags, ...(group.parent_tag ? [group.parent_tag] : [])]),
      );
      const members = combined.slice(0, values.tags.length);
      const parent = values.parent_tag ? combined[combined.length - 1] : null;
      if (selectorsConflict(members, parent)) {
        return jsonError("parent_tag must not also be a member tag", { code: "parent_member_conflict" });
      }
      await validatePermissionGroups(client, values.permissions, extra.signal);

      const tagGroup = completeTagGroupBody({
        name: values.name,
        tags: members,
        parent,
        onePerTopic: values.one_per_topic,
        permissions: values.permissions,
      });

      let response: unknown;
      try {
        response = await tagGroupMutation(base, () => client.postNoRetry(
          "/tag_groups.json",
          { tag_group: tagGroup },
          { signal: extra.signal },
        ));
      } catch (error) {
        if (!(error instanceof HttpError) || error.status >= 500) return outcomeUnknown("Create tag group", 0, error instanceof Error ? error.message : String(error));
        throw error;
      }

      try {
        const normalized = tagGroupOutputSchema.parse({ tag_group: unwrapTagGroup(response) });
        return structuredJsonResponse(normalized);
      } catch (error) {
        return outcomeUnknown("Create tag group", 0, error instanceof Error ? error.message : String(error));
      }
    } catch (error) {
      if (isZodError(error)) return zodError(error);
      return tagGroupError("Failed to create tag group", error);
    }
  },
});

export const updateTagGroupTool = defineTool({
  name: "discourse_update_tag_group",
  title: "Update Tag Group",
  description: "Safely replace complete tag-group state after a fresh expected_state_hash preflight. Omitted mutable fields are preserved locally, but Discourse receives full tags, parent, one-per-topic, and numeric permissions because partial upstream bodies clear state. Tag/parent removals, permission replacement, and possible materialization of serializer-synthesized everyone/full permissions require explicit acknowledgements. The hash is advisory rather than an upstream atomic lock; uncertain post-dispatch outcomes must not be retried blindly.",
  schema: updateTagGroupInputSchema,
  outputSchema: tagGroupOutputSchema,
  availability: "writes_enabled",
  toolsets: ["tag_groups"],
  annotations: replacementAnnotations,
  handler: async (input, extra, ctx, opts) => {
    try {
      const rawInput = input as Record<string, unknown>;
      const values = updateTagGroupInputSchema.parse(input);
      if (!mutableUpdateRequested(rawInput)) return jsonError("Provide at least one mutable field to update", { code: "no_op" });
      const denied = requireTagGroupWrite(ctx.siteState, opts);
      if (denied) return denied;
      const { base, client } = ctx.siteState.ensureSelectedSite();
      const current = await getTagGroup(client, values.id, extra.signal);
      if (current.state_hash !== values.expected_state_hash) return conflictError(values.id, current);

      const desiredName = values.name ?? current.name;
      if (values.name !== undefined && folded(values.name) !== folded(current.name)) {
        const inventory = await listTagGroups(client, extra.signal);
        if (inventory.some((group) => group.id !== current.id && folded(group.name) === folded(values.name!))) {
          return jsonError("A different tag group already uses this name (case-insensitive advisory preflight)", { code: "duplicate_name" });
        }
      }

      const currentState = currentSelectors(current);
      const memberSelectors: TagSelector[] = values.tags ?? currentState.tags;
      const parentSelector: TagSelector | null = Object.prototype.hasOwnProperty.call(rawInput, "parent_tag")
        ? values.parent_tag ?? null
        : currentState.parent;
      const combined = await resolveTagSelectors(
        client,
        [...memberSelectors, ...(parentSelector ? [parentSelector] : [])],
        values.allow_tag_creation,
        extra.signal,
        [...current.tags, ...(current.parent_tag ? [current.parent_tag] : [])],
      );
      const members = combined.slice(0, memberSelectors.length);
      const parent = parentSelector ? combined[combined.length - 1] : null;
      if (selectorsConflict(members, parent)) {
        return jsonError("parent_tag must not also be a member tag", { code: "parent_member_conflict" });
      }

      const currentIds = new Set(current.tags.map((tag) => `id:${tag.id}`));
      const removesTags = [...currentIds].some((id) => !members.some((member) => member.identity === id));
      if (removesTags && !values.confirm_tag_removal) {
        return jsonError("Replacing tags removes existing memberships; set confirm_tag_removal=true after review", { code: "confirmation_required" });
      }
      const removesParent = Boolean(current.parent_tag && parent?.identity !== `id:${current.parent_tag.id}`);
      if (removesParent && !values.confirm_parent_removal) {
        return jsonError("Changing or clearing parent_tag removes the current parent relationship; set confirm_parent_removal=true", { code: "confirmation_required" });
      }

      const permissions: Permissions = values.permissions ?? current.permissions;
      if (values.permissions !== undefined && !samePermissions(values.permissions, current.permissions) && !values.confirm_permission_replacement) {
        return jsonError("Permission updates replace the complete permission set; set confirm_permission_replacement=true", { code: "confirmation_required" });
      }
      await validatePermissionGroups(client, permissions, extra.signal);
      const desiredMemberIds = members.flatMap((member) => "id" in member.payload ? [member.payload.id] : []);
      const currentMemberIds = current.tags.map((tag) => tag.id);
      const sameMembers = desiredMemberIds.length === members.length &&
        desiredMemberIds.length === currentMemberIds.length &&
        desiredMemberIds.every((id) => currentMemberIds.includes(id));
      const sameParent = parent === null
        ? current.parent_tag === null
        : "id" in parent.payload && parent.payload.id === current.parent_tag?.id;
      if (
        desiredName === current.name &&
        sameMembers &&
        sameParent &&
        (values.one_per_topic ?? current.one_per_topic) === current.one_per_topic &&
        samePermissions(permissions, current.permissions)
      ) {
        return jsonError("Requested mutable values are already the current tag-group state", { code: "no_op" });
      }
      const warning = syntheticPermissionWarning(current);
      if (warning && !values.acknowledge_possible_synthetic_permission_materialization) {
        return jsonError(`${warning} Set acknowledge_possible_synthetic_permission_materialization=true after review.`, {
          code: "confirmation_required",
        });
      }

      const tagGroup = completeTagGroupBody({
        name: desiredName,
        tags: members,
        parent,
        onePerTopic: values.one_per_topic ?? current.one_per_topic,
        permissions,
      });

      let response: any;
      try {
        response = await tagGroupMutation(base, () => client.putNoRetry(
          `/tag_groups/${values.id}.json`,
          { tag_group: tagGroup },
          { signal: extra.signal },
        ));
      } catch (error) {
        if (!(error instanceof HttpError) || error.status >= 500) return outcomeUnknown("Update tag group", values.id, error instanceof Error ? error.message : String(error));
        throw error;
      }

      if (
        response?.success !== "OK" ||
        !response?.tag_group
      ) {
        return outcomeUnknown("Update tag group", values.id, "Upstream did not return the expected success and tag_group acknowledgement");
      }
      try {
        // Validate the acknowledgement wrapper before relying on a verification read.
        normalizeTagGroup(response.tag_group);
      } catch (error) {
        return outcomeUnknown("Update tag group", values.id, error instanceof Error ? error.message : String(error));
      }

      let postState: TagGroupRecord;
      try {
        postState = await getTagGroup(client, values.id, extra.signal);
      } catch (error) {
        return outcomeUnknown("Update tag group", values.id, error instanceof Error ? error.message : String(error));
      }
      const normalized = tagGroupOutputSchema.parse({
        tag_group: postState,
        ...(warning ? { warnings: [warning] } : {}),
      });
      return structuredJsonResponse(normalized);
    } catch (error) {
      if (isZodError(error)) return zodError(error);
      return tagGroupError("Failed to update tag group", error);
    }
  },
});

export const deleteTagGroupTool = defineTool({
  name: "discourse_delete_tag_group",
  title: "Delete Tag Group",
  description: "Permanently delete one exact tag group after fresh name/state-hash checks and explicit acknowledgements for category relationship cascades and unresolved plugin dependencies. Deletion removes memberships, permissions, and category allowed/required relationships, but not tags or topic-tag rows. Dependency discovery is not exhaustive (plugins such as RSS polling may depend on groups). Scoped API keys may not include this delete route. A 200 response is only dispatch acknowledgement; absence is verified before success.",
  schema: deleteTagGroupInputSchema,
  outputSchema: deleteTagGroupOutputSchema,
  availability: "writes_enabled",
  toolsets: ["tag_groups"],
  annotations: deleteAnnotations,
  handler: async (input, extra, ctx, opts) => {
    try {
      const values = deleteTagGroupInputSchema.parse(input);
      const denied = requireTagGroupWrite(ctx.siteState, opts);
      if (denied) return denied;
      const { base, client } = ctx.siteState.ensureSelectedSite();
      const current = await getTagGroup(client, values.id, extra.signal);
      if (current.id !== values.id) {
        return jsonError("Fresh tag-group detail ID does not match the requested ID", {
          code: "identity_mismatch",
          requested_id: values.id,
          returned_id: current.id,
        });
      }
      if (current.name !== values.name) {
        return jsonError("Exact current tag-group name does not match", {
          code: "identity_mismatch",
          id: current.id,
          current_name: current.name,
        });
      }
      if (current.state_hash !== values.expected_state_hash) return conflictError(values.id, current);

      let response: any;
      try {
        response = await tagGroupMutation(base, () => client.deleteNoRetry(
          `/tag_groups/${values.id}.json`,
          undefined,
          { signal: extra.signal },
        ));
      } catch (error) {
        if (!(error instanceof HttpError) || error.status >= 500) return outcomeUnknown("Delete tag group", values.id, error instanceof Error ? error.message : String(error));
        throw error;
      }
      if (response?.success !== "OK") {
        return outcomeUnknown("Delete tag group", values.id, "Upstream did not return the expected success acknowledgement");
      }

      try {
        await getTagGroup(client, values.id, extra.signal);
        return outcomeUnknown("Delete tag group", values.id, "Post-delete read still returned the tag group");
      } catch (error) {
        if (!isNotFound(error)) return outcomeUnknown("Delete tag group", values.id, error instanceof Error ? error.message : String(error));
      }

      const normalized = deleteTagGroupOutputSchema.parse({
        deleted: true,
        id: current.id,
        name: current.name,
        impact: {
          member_tags: current.tags,
          parent_tag: current.parent_tag,
          permissions: current.permissions,
          category_relationships: {
            included: false,
            reason: "The bounded category projection does not authoritatively expose allowed/required tag-group relationships; no category N+1 fan-out was performed.",
          },
          dependency_discovery_exhaustive: false,
        },
      });
      return structuredJsonResponse(normalized);
    } catch (error) {
      if (isZodError(error)) return zodError(error);
      return tagGroupError("Failed to delete tag group", error);
    }
  },
});
