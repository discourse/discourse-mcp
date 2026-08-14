import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z, type AnyZodObject, type ZodRawShape } from "zod";
import {
  OPT_IN_TOOLSETS,
  type BuiltinToolset,
  type BuiltinToolsetMembership,
} from "./toolsets.js";
import type {
  ToolContext,
  ToolRegistrationOptions,
} from "./types.js";

/** Mutually exclusive configuration gate controlling whether a tool is registered. */
export type ToolAvailability =
  | "always"
  | "writes_enabled"
  | "site_selection";

type SdkToolCallback = ToolCallback<ZodRawShape>;
export type ToolExtra = Parameters<SdkToolCallback>[1];
export type ToolResult = Awaited<ReturnType<SdkToolCallback>>;
type ErasedToolInput = Parameters<SdkToolCallback>[0];

/** Authoring-time type that infers a handler's input from its Zod schema. */
export interface ToolSpec<Schema extends AnyZodObject> {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly schema: Schema;
  readonly availability: ToolAvailability;
  /** Operator-facing domains; membership is plural and independent of access policy. */
  readonly toolsets: BuiltinToolsetMembership;
  readonly annotations?: ToolAnnotations;
  readonly handler: (
    input: z.output<Schema>,
    extra: ToolExtra,
    ctx: ToolContext,
    opts: ToolRegistrationOptions
  ) => ToolResult | Promise<ToolResult>;
}

/** Erased type used to store heterogeneous tool definitions in one collection. */
export interface ToolDefinition {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly schema: AnyZodObject;
  readonly availability: ToolAvailability;
  readonly toolsets: BuiltinToolsetMembership;
  readonly annotations?: ToolAnnotations;
  readonly handler: (
    input: ErasedToolInput,
    extra: ToolExtra,
    ctx: ToolContext,
    opts: ToolRegistrationOptions
  ) => ToolResult | Promise<ToolResult>;
}

/**
 * Preserve schema-derived input inference while authoring, then erase the
 * schema/handler association only at the heterogeneous collection boundary.
 */
export function defineTool<Schema extends AnyZodObject>(
  spec: ToolSpec<Schema>
): ToolDefinition {
  return spec as unknown as ToolDefinition;
}

/** Register definitions in order, applying only registration-time filtering. */
export function registerToolDefinitions(
  definitions: readonly ToolDefinition[],
  ctx: ToolContext,
  opts: ToolRegistrationOptions
): string[] {
  const registeredNames: string[] = [];
  const selectedToolsets = opts.toolsets
    ? new Set<BuiltinToolset>(opts.toolsets)
    : undefined;

  const optInToolsets = new Set<BuiltinToolset>(OPT_IN_TOOLSETS);

  for (const definition of definitions) {
    const optInOnly = definition.toolsets.every((toolset) => optInToolsets.has(toolset));
    if (!selectedToolsets && optInOnly) continue;

    // Site selection is the bootstrap capability for every untethered subset.
    if (
      selectedToolsets &&
      definition.availability !== "site_selection" &&
      !definition.toolsets.some((toolset) => selectedToolsets.has(toolset))
    ) {
      continue;
    }
    if (definition.availability === "writes_enabled" && !opts.allowWrites) {
      continue;
    }
    if (definition.availability === "site_selection" && opts.hideSelectSite) {
      continue;
    }

    ctx.server.registerTool(
      definition.name,
      {
        title: definition.title,
        description: definition.description,
        inputSchema: definition.schema.shape,
        annotations: definition.annotations,
      },
      (input, extra) => definition.handler(input, extra, ctx, opts)
    );
    registeredNames.push(definition.name);
  }

  return registeredNames;
}
