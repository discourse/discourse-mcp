import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z, type AnyZodObject, type ZodRawShape } from "zod";
import type {
  ToolContext,
  ToolRegistrationOptions,
} from "./types.js";

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
): void {
  for (const definition of definitions) {
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
      },
      (input, extra) => definition.handler(input, extra, ctx, opts)
    );
  }
}
