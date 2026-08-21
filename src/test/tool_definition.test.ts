import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { Logger } from "../util/logger.js";
import { SiteState } from "../site/state.js";
import { jsonResponse, structuredJsonResponse } from "../util/json_response.js";
import {
  defineTool,
  registerToolDefinitions,
  type ToolDefinition,
  type ToolExtra,
  type ToolResult,
} from "../tools/definition.js";
import type {
  ToolContext,
  ToolRegistrar,
  ToolRegistrationOptions,
} from "../tools/types.js";

// Compile-time fixture: authoring preserves schema-derived input inference.
const inferredSchema = z.object({ count: z.number(), label: z.string() }).strict();
const inferredTool = defineTool({
  name: "fixture_inferred",
  title: "Inferred Fixture",
  description: "Exercises inferred handler input.",
  schema: inferredSchema,
  availability: "always",
  toolsets: ["search"],
  handler: (input) => {
    input.count.toFixed();
    input.label.toUpperCase();
    // @ts-expect-error The strict schema does not contain this property.
    void input.missing;
    // @ts-expect-error count is inferred as a number, not a string.
    const wrong: string = input.count;
    void wrong;
    // Explicit parsing remains valid for migrated handlers.
    inferredSchema.parse(input);
    return jsonResponse({ ok: true });
  },
});

const otherTool = defineTool({
  name: "fixture_other",
  title: "Other Fixture",
  description: "Has a heterogeneous schema.",
  schema: z.object({ enabled: z.boolean() }),
  availability: "always",
  toolsets: ["users"],
  handler: ({ enabled }) => jsonResponse({ enabled }),
});

const heterogeneousDefinitions = [
  inferredTool,
  otherTool,
] as const satisfies readonly ToolDefinition[];
void heterogeneousDefinitions;

const structuredOutputSchema = z.object({ count: z.number() });
const structuredTool = defineTool({
  name: "fixture_structured",
  title: "Structured Fixture",
  description: "Checks schema-linked structured output typing.",
  schema: z.object({ label: z.string() }),
  outputSchema: structuredOutputSchema,
  availability: "always",
  toolsets: ["search"],
  handler: ({ label }) => structuredJsonResponse({ count: label.length }),
});
void structuredTool;

const invalidStructuredTool = defineTool({
  name: "fixture_invalid_structured",
  title: "Invalid Structured Fixture",
  description: "Proves incorrect structured output fails project typecheck.",
  schema: z.object({}),
  outputSchema: structuredOutputSchema,
  availability: "always",
  toolsets: ["search"],
  // @ts-expect-error count must conform to the declared numeric output schema.
  handler: () => structuredJsonResponse({ count: "wrong" }),
});
void invalidStructuredTool;

const invalidToolsetTool = defineTool({
  name: "fixture_invalid_toolset",
  title: "Invalid Toolset Fixture",
  description: "Proves toolset names are checked while authoring.",
  schema: z.object({}),
  availability: "always",
  // @ts-expect-error Unknown toolset names are rejected at the definition site.
  toolsets: ["data_explroer"],
  handler: () => jsonResponse({ ok: true }),
});
void invalidToolsetTool;

const emptyToolsetsTool = defineTool({
  name: "fixture_empty_toolsets",
  title: "Empty Toolsets Fixture",
  description: "Proves every definition belongs to at least one toolset.",
  schema: z.object({}),
  availability: "always",
  // @ts-expect-error A built-in definition must have at least one toolset.
  toolsets: [],
  handler: () => jsonResponse({ ok: true }),
});
void emptyToolsetsTool;

interface CapturedRegistration {
  name: string;
  metadata: {
    title?: string;
    description?: string;
    inputSchema?: z.ZodTypeAny;
    outputSchema?: z.ZodTypeAny;
  };
  handler: (input: Record<string, unknown>, extra: ToolExtra) => ToolResult | Promise<ToolResult>;
}

function createRegistrar(): {
  server: ToolRegistrar;
  calls: CapturedRegistration[];
} {
  const calls: CapturedRegistration[] = [];
  const server = {
    registerTool(
      name: string,
      metadata: CapturedRegistration["metadata"],
      handler: CapturedRegistration["handler"]
    ) {
      calls.push({ name, metadata, handler });
      return {};
    },
  } as unknown as ToolRegistrar;
  return { server, calls };
}

function createContext(server: ToolRegistrar): ToolContext {
  const logger = new Logger("silent");
  return {
    server,
    siteState: new SiteState({
      logger,
      timeoutMs: 5000,
      defaultAuth: { type: "none" },
    }),
    logger,
    maxReadLength: 50000,
  };
}

const baseOptions: ToolRegistrationOptions = {
  allowWrites: false,
  toolsMode: "discourse_api_only",
};

const invalidEmptySelection: ToolRegistrationOptions = {
  ...baseOptions,
  // @ts-expect-error Programmatic toolset selections must also be non-empty.
  toolsets: [],
};
void invalidEmptySelection;

test("registerToolDefinitions filters availability and preserves collection order", () => {
  const { server, calls } = createRegistrar();
  const ctx = createContext(server);
  const definitions = [
    defineTool({
      name: "always_first",
      title: "Always First",
      description: "Always available.",
      schema: z.object({ value: z.string() }),
      availability: "always",
      toolsets: ["search"],
      handler: () => jsonResponse({ ok: true }),
    }),
    defineTool({
      name: "write_second",
      title: "Write Second",
      description: "Write gated.",
      schema: z.object({ value: z.number() }),
      availability: "writes_enabled",
      toolsets: ["users", "topics"],
      handler: () => jsonResponse({ ok: true }),
    }),
    defineTool({
      name: "selection_third",
      title: "Selection Third",
      description: "Site-selection gated.",
      schema: z.object({ site: z.string() }),
      availability: "site_selection",
      toolsets: ["site"],
      handler: () => jsonResponse({ ok: true }),
    }),
  ] as const satisfies readonly ToolDefinition[];

  registerToolDefinitions(definitions, ctx, baseOptions);
  assert.deepEqual(calls.map((call) => call.name), [
    "always_first",
    "selection_third",
  ]);

  calls.length = 0;
  registerToolDefinitions(definitions, ctx, {
    ...baseOptions,
    allowWrites: true,
  });
  assert.deepEqual(calls.map((call) => call.name), [
    "always_first",
    "write_second",
    "selection_third",
  ]);

  calls.length = 0;
  registerToolDefinitions(definitions, ctx, {
    ...baseOptions,
    allowWrites: true,
    hideSelectSite: true,
  });
  assert.deepEqual(calls.map((call) => call.name), [
    "always_first",
    "write_second",
  ]);

  calls.length = 0;
  registerToolDefinitions(definitions, ctx, {
    ...baseOptions,
    allowWrites: true,
    toolsets: ["users"],
  });
  assert.deepEqual(calls.map((call) => call.name), [
    "write_second",
    "selection_third",
  ]);

  calls.length = 0;
  registerToolDefinitions(definitions, ctx, {
    ...baseOptions,
    allowWrites: true,
    toolsets: ["search", "users"],
  });
  assert.deepEqual(calls.map((call) => call.name), [
    "always_first",
    "write_second",
    "selection_third",
  ]);

  calls.length = 0;
  registerToolDefinitions(definitions, ctx, {
    ...baseOptions,
    allowWrites: false,
    toolsets: ["users"],
  });
  assert.deepEqual(calls.map((call) => call.name), ["selection_third"]);
});

test("registerToolDefinitions forwards metadata, schema shape, handler arguments, context, and options", async () => {
  const { server, calls } = createRegistrar();
  const ctx = createContext(server);
  const opts: ToolRegistrationOptions = {
    allowWrites: true,
    toolsMode: "auto",
    showEmails: true,
  };
  const schema = z.object({ value: z.string() });
  const input = { value: "unchanged" };
  const extra = { sentinel: true } as unknown as ToolExtra;
  let received:
    | {
        input: typeof input;
        extra: ToolExtra;
        ctx: ToolContext;
        opts: ToolRegistrationOptions;
        server: ToolRegistrar;
      }
    | undefined;

  const definition = defineTool({
    name: "forwarding_fixture",
    title: "Forwarding Fixture",
    description: "Forwards registration and invocation values unchanged.",
    schema,
    availability: "always",
    toolsets: ["search"],
    handler: (handlerInput, handlerExtra, handlerCtx, handlerOpts) => {
      received = {
        input: handlerInput,
        extra: handlerExtra,
        ctx: handlerCtx,
        opts: handlerOpts,
        server: handlerCtx.server,
      };
      return jsonResponse({ value: handlerInput.value });
    },
  });

  registerToolDefinitions([definition], ctx, opts);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, definition.name);
  assert.equal(calls[0].metadata.title, definition.title);
  assert.equal(calls[0].metadata.description, definition.description);
  assert.equal(calls[0].metadata.inputSchema, schema);

  const result = await calls[0].handler(input, extra);
  assert.deepEqual(result, jsonResponse({ value: "unchanged" }));
  assert.equal(received?.input, input);
  assert.equal(received?.extra, extra);
  assert.equal(received?.ctx, ctx);
  assert.equal(received?.opts, opts);
  assert.equal(received?.server, server);
});

test("registerToolDefinitions forwards optional output schemas without affecting unstructured tools", () => {
  const { server, calls } = createRegistrar();
  const ctx = createContext(server);
  const outputSchema = z.object({ ok: z.boolean() });
  const structured = defineTool({
    name: "structured_registration_fixture",
    title: "Structured Registration Fixture",
    description: "Advertises an output schema.",
    schema: z.object({}),
    outputSchema,
    availability: "always",
    toolsets: ["search"],
    handler: () => structuredJsonResponse({ ok: true }),
  });
  const plain = defineTool({
    name: "plain_registration_fixture",
    title: "Plain Registration Fixture",
    description: "Does not advertise an output schema.",
    schema: z.object({}),
    availability: "always",
    toolsets: ["search"],
    handler: () => jsonResponse({ ok: true }),
  });

  registerToolDefinitions([structured, plain], ctx, baseOptions);
  assert.equal(calls[0].metadata.outputSchema, outputSchema);
  assert.equal("outputSchema" in calls[1].metadata, false);
});
