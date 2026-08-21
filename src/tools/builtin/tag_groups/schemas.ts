import { z } from "zod";

export const tagGroupIdSchema = z.number().int().positive();
export const tagGroupNameSchema = z.string().trim().min(1).max(100);

export const tagSelectorSchema = z.union([
  z.object({ id: z.number().int().positive() }).strict(),
  z.object({ name: z.string().trim().min(1).max(100) }).strict(),
]);

const permissionValueSchema = z.union([z.literal(1), z.literal(3)]);
export const permissionsSchema = z.record(permissionValueSchema).superRefine((permissions, ctx) => {
  const keys = Object.keys(permissions);
  if (keys.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "permissions must contain at least one complete group policy" });
  }
  for (const key of keys) {
    if (!/^(0|[1-9]\d*)$/.test(key)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `permission key '${key}' must be a canonical nonnegative integer group ID` });
    }
  }
});

export const tagRecordSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  slug: z.string().min(1),
}).passthrough();

export const tagGroupRecordSchema = z.object({
  id: tagGroupIdSchema,
  name: z.string().min(1),
  tags: z.array(tagRecordSchema),
  parent_tag: tagRecordSchema.nullable(),
  one_per_topic: z.boolean(),
  permissions: permissionsSchema,
  state_hash: z.string().regex(/^[a-f0-9]{64}$/),
}).passthrough();

export const searchTagGroupsInputSchema = z.object({
  q: z.string().trim().min(1).max(250).optional(),
  names: z.array(tagGroupNameSchema).min(1).max(100).superRefine((names, ctx) => {
    const seen = new Set<string>();
    names.forEach((name, index) => {
      const folded = name.toLocaleLowerCase("en-US");
      if (seen.has(folded)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index], message: "names must be unique case-insensitively" });
      seen.add(folded);
    });
  }).optional(),
  limit: z.number().int().min(1).max(1000).default(100),
}).strict();

export const searchTagGroupsOutputSchema = z.object({
  results: z.array(z.object({
    name: z.string().min(1),
    tags: z.array(tagRecordSchema),
  }).passthrough()),
  meta: z.object({
    limit: z.number().int().min(1).max(1000),
    returned: z.number().int().nonnegative(),
    truncated: z.boolean(),
  }),
});

export const listTagGroupsOutputSchema = z.object({
  tag_groups: z.array(tagGroupRecordSchema),
});

export const tagGroupOutputSchema = z.object({
  tag_group: tagGroupRecordSchema,
  warnings: z.array(z.string()).optional(),
});

export const createTagGroupInputSchema = z.object({
  name: tagGroupNameSchema,
  tags: z.array(tagSelectorSchema).min(1).max(1000),
  parent_tag: tagSelectorSchema.optional(),
  one_per_topic: z.boolean().default(false),
  permissions: permissionsSchema,
  allow_tag_creation: z.boolean().default(false),
}).strict();

export const updateTagGroupInputSchema = z.object({
  id: tagGroupIdSchema,
  expected_state_hash: z.string().regex(/^[a-f0-9]{64}$/),
  name: tagGroupNameSchema.optional(),
  tags: z.array(tagSelectorSchema).min(1).max(1000).optional(),
  parent_tag: tagSelectorSchema.nullable().optional(),
  one_per_topic: z.boolean().optional(),
  permissions: permissionsSchema.optional(),
  allow_tag_creation: z.boolean().default(false),
  confirm_tag_removal: z.boolean().default(false),
  confirm_parent_removal: z.boolean().default(false),
  confirm_permission_replacement: z.boolean().default(false),
  acknowledge_possible_synthetic_permission_materialization: z.boolean().default(false),
}).strict();

export const deleteTagGroupInputSchema = z.object({
  id: tagGroupIdSchema,
  name: z.string().min(1),
  expected_state_hash: z.string().regex(/^[a-f0-9]{64}$/),
  confirm_delete: z.literal(true),
  acknowledge_category_relationship_removal: z.literal(true),
  acknowledge_unresolved_plugin_dependencies: z.literal(true),
}).strict();

export const deleteTagGroupOutputSchema = z.object({
  deleted: z.literal(true),
  id: tagGroupIdSchema,
  name: z.string().min(1),
  impact: z.object({
    member_tags: z.array(tagRecordSchema),
    parent_tag: tagRecordSchema.nullable(),
    permissions: permissionsSchema,
    category_relationships: z.object({
      included: z.literal(false),
      reason: z.string(),
    }),
    dependency_discovery_exhaustive: z.literal(false),
  }),
});

export type TagSelector = z.output<typeof tagSelectorSchema>;
export type TagGroupRecord = z.output<typeof tagGroupRecordSchema>;
export type Permissions = z.output<typeof permissionsSchema>;
