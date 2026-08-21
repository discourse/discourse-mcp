import { z } from "zod";

export const directoryTruncatedReasonSchema = z.enum([
  "page_limit",
  "deadline",
  "cancelled",
  "no_new_ids",
  "total_mismatch",
  "legacy_site_json",
  "anonymous_fallback",
  "upstream_error",
]);

export const directoryMetaSchema = z.object({
  total: z.number().int().nonnegative(),
  reported_total: z.number().int().nonnegative().nullable(),
  pages_fetched: z.number().int().nonnegative(),
  complete: z.boolean(),
  has_more: z.boolean(),
  truncated_reason: directoryTruncatedReasonSchema.optional(),
  error: z.string().optional(),
});

export const categoryRecordSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  slug: z.string().min(1),
  pid: z.number().int().positive().nullable(),
  parent_category_id: z.number().int().positive().nullable(),
  read_restricted: z.boolean(),
  topic_count: z.number().int().nonnegative(),
  post_count: z.number().int().nonnegative(),
  perms: z.array(z.object({
    gid: z.number().int().nonnegative(),
    perm: z.number().int(),
  })).optional(),
}).passthrough();

export const categoryDirectoryOutputSchema = z.object({
  categories: z.array(categoryRecordSchema),
  meta: directoryMetaSchema,
});

/** Rich upstream group records remain passthrough for compatibility. */
export const groupRecordSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
}).passthrough();

export const groupDirectoryOutputSchema = z.object({
  groups: z.array(groupRecordSchema),
  meta: directoryMetaSchema,
  extras: z.unknown().optional(),
  total_rows_groups: z.number().int().nonnegative().optional(),
  load_more_groups: z.string().nullable().optional(),
});
