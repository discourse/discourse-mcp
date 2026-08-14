import { z } from "zod";

/**
 * Operator-selectable domains for built-in tools.
 *
 * Toolsets describe what a tool is for. They are independent from registration
 * gates such as write enablement and from call-time authentication checks.
 */
export const BUILTIN_TOOLSETS = [
  "site",
  "search",
  "topics",
  "users",
  "chat",
  "drafts",
  "uploads",
  "data_explorer",
  "workflows",
  "ai_agents",
  "ai_custom_tools",
  "ai_features",
] as const;

export type BuiltinToolset = (typeof BUILTIN_TOOLSETS)[number];

/** Domains hidden unless explicitly selected or `all` is used. */
export const OPT_IN_TOOLSETS = [
  "workflows",
  "ai_agents",
  "ai_custom_tools",
  "ai_features",
] as const satisfies readonly BuiltinToolset[];

/** One or more domains assigned to a built-in tool definition or selection. */
export type BuiltinToolsetMembership = readonly [
  BuiltinToolset,
  ...BuiltinToolset[],
];

const BuiltinToolsetSchema = z.enum(BUILTIN_TOOLSETS);

export const BuiltinToolsetsSchema = z
  .union([z.string(), z.array(z.string())])
  .transform((value, ctx): BuiltinToolsetMembership => {
    const values = (Array.isArray(value) ? value : value.split(","))
      .flatMap((item) => item.split(","))
      .map((item) => item.trim())
      .filter(Boolean);

    if (values.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Select at least one built-in toolset",
      });
      return z.NEVER;
    }

    if (values.includes("all")) {
      return [...BUILTIN_TOOLSETS] as BuiltinToolsetMembership;
    }

    const result: BuiltinToolset[] = [];
    let invalid = false;
    for (const candidate of values) {
      const parsed = BuiltinToolsetSchema.safeParse(candidate);
      if (!parsed.success) {
        invalid = true;
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unknown built-in toolset '${candidate}'. Expected one of: ${BUILTIN_TOOLSETS.join(", ")}, all`,
        });
        continue;
      }
      if (!result.includes(parsed.data)) result.push(parsed.data);
    }

    return invalid ? z.NEVER : result as unknown as BuiltinToolsetMembership;
  });

/** Parse CLI/profile input into a de-duplicated list of built-in toolsets. */
export function parseBuiltinToolsets(
  value: unknown,
  source: string
): BuiltinToolsetMembership | undefined {
  if (value === undefined || value === null) return undefined;

  if (
    typeof value !== "string" &&
    !(Array.isArray(value) && value.every((item) => typeof item === "string"))
  ) {
    throw new Error(
      `Invalid toolsets ${source}: expected a comma-separated string or string array. Expected one of: ${BUILTIN_TOOLSETS.join(", ")}, all`
    );
  }

  const result = BuiltinToolsetsSchema.safeParse(value);
  if (!result.success) {
    throw new Error(`Invalid toolsets ${source}: ${result.error.issues.map((issue) => issue.message).join("; ")}`);
  }
  return result.data;
}
