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

/** A structured tool either returns schema-conforming success data or a plain MCP error. */
export type StructuredToolResult<Output extends Record<string, unknown>> = ToolResult & (
  | { readonly structuredContent: Output; readonly isError?: false }
  | { readonly isError: true; readonly structuredContent?: never }
);

type HandlerResult<OutputSchema extends AnyZodObject | undefined> =
  OutputSchema extends AnyZodObject
    ? StructuredToolResult<z.output<OutputSchema>>
    : ToolResult;

/** Authoring-time type that infers a handler's input and structured output from Zod schemas. */
export interface ToolSpec<
  Schema extends AnyZodObject,
  OutputSchema extends AnyZodObject | undefined = undefined,
> {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly schema: Schema;
  readonly outputSchema?: OutputSchema;
  readonly availability: ToolAvailability;
  /** Operator-facing domains; membership is plural and independent of access policy. */
  readonly toolsets: BuiltinToolsetMembership;
  readonly annotations?: ToolAnnotations;
  readonly handler: (
    input: z.output<Schema>,
    extra: ToolExtra,
    ctx: ToolContext,
    opts: ToolRegistrationOptions
  ) => HandlerResult<OutputSchema> | Promise<HandlerResult<OutputSchema>>;
}

/** Erased type used to store heterogeneous tool definitions in one collection. */
export interface ToolDefinition {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly schema: AnyZodObject;
  readonly outputSchema?: AnyZodObject;
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
export function defineTool<
  Schema extends AnyZodObject,
  OutputSchema extends AnyZodObject | undefined = undefined,
>(
  spec: ToolSpec<Schema, OutputSchema>
): ToolDefinition {
  // This is the sole erasure cast: heterogeneous catalogs intentionally forget
  // each schema/handler association after it has been checked at authoring time.
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

    ctx.server.registerTool<AnyZodObject, AnyZodObject>(
      definition.name,
      {
        title: definition.title,
        description: definition.description,
        inputSchema: definition.schema,
        ...(definition.outputSchema
          ? { outputSchema: definition.outputSchema }
          : {}),
        annotations: definition.annotations,
      },
      (input: ErasedToolInput, extra: ToolExtra) =>
        definition.handler(input, extra, ctx, opts)
    );
    registeredNames.push(definition.name);
  }

  return registeredNames;
}
