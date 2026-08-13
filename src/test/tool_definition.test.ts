import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { Logger } from "../util/logger.js";
import { SiteState } from "../site/state.js";
import { jsonResponse } from "../util/json_response.js";
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
  handler: ({ enabled }) => jsonResponse({ enabled }),
});

const heterogeneousDefinitions = [
  inferredTool,
  otherTool,
] as const satisfies readonly ToolDefinition[];
void heterogeneousDefinitions;

interface CapturedRegistration {
  name: string;
  metadata: {
    title?: string;
    description?: string;
    inputSchema?: Record<string, z.ZodTypeAny>;
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
      handler: () => jsonResponse({ ok: true }),
    }),
    defineTool({
      name: "write_second",
      title: "Write Second",
      description: "Write gated.",
      schema: z.object({ value: z.number() }),
      availability: "writes_enabled",
      handler: () => jsonResponse({ ok: true }),
    }),
    defineTool({
      name: "selection_third",
      title: "Selection Third",
      description: "Site-selection gated.",
      schema: z.object({ site: z.string() }),
      availability: "site_selection",
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
  assert.deepEqual(calls[0].metadata.inputSchema, schema.shape);

  const result = await calls[0].handler(input, extra);
  assert.deepEqual(result, jsonResponse({ value: "unchanged" }));
  assert.equal(received?.input, input);
  assert.equal(received?.extra, extra);
  assert.equal(received?.ctx, ctx);
  assert.equal(received?.opts, opts);
  assert.equal(received?.server, server);
});
