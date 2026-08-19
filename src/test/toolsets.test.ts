import test from "node:test";
import assert from "node:assert/strict";
import {
  BUILTIN_TOOLSETS,
  BuiltinToolsetsSchema,
  OPT_IN_TOOLSETS,
  parseBuiltinToolsets,
} from "../tools/toolsets.js";

const expectedToolsets = [
  "site",
  "search",
  "topics",
  "users",
  "chat",
  "drafts",
  "uploads",
  "data_explorer",
  "private_messages",
  "activity",
  "administration",
  "groups",
  "moderation",
  "workflows",
  "ai_agents",
  "ai_custom_tools",
  "ai_features",
  "analytics",
  "ai_insights",
];

const expectedOptInToolsets = ["activity", "administration", "groups", "moderation", "workflows", "ai_agents", "ai_custom_tools", "ai_features", "analytics", "ai_insights"];

test("built-in toolset names are stable and documented", () => {
  assert.deepEqual(BUILTIN_TOOLSETS, expectedToolsets);
  assert.deepEqual(OPT_IN_TOOLSETS, expectedOptInToolsets);
});

test("all expands to every built-in toolset and absorbs extras", () => {
  assert.deepEqual(parseBuiltinToolsets("all", "from CLI"), BUILTIN_TOOLSETS);
  assert.deepEqual(parseBuiltinToolsets("search,all", "from CLI"), BUILTIN_TOOLSETS);
  assert.deepEqual(BuiltinToolsetsSchema.parse(["all", "topics"]), BUILTIN_TOOLSETS);
});

test("toolset parser accepts a single CLI value", () => {
  assert.deepEqual(parseBuiltinToolsets("data_explorer", "from CLI"), [
    "data_explorer",
  ]);
});

test("toolset parser accepts comma-separated values and removes duplicates", () => {
  assert.deepEqual(
    parseBuiltinToolsets(
      " topics, users,topics , data_explorer ",
      "from CLI"
    ),
    ["topics", "users", "data_explorer"]
  );
});

test("toolset parser accepts the profile array form", () => {
  assert.deepEqual(
    parseBuiltinToolsets(["data_explorer", "uploads"], "from profile"),
    ["data_explorer", "uploads"]
  );
});

test("toolset schema normalizes the profile string form", () => {
  assert.deepEqual(BuiltinToolsetsSchema.parse("search,chat"), [
    "search",
    "chat",
  ]);
});

test("toolset parser rejects unknown, mixed-invalid, empty, and non-string values", () => {
  assert.throws(
    () => parseBuiltinToolsets("data_explroer", "from CLI"),
    /Unknown built-in toolset 'data_explroer'.*data_explorer/
  );
  assert.throws(
    () => parseBuiltinToolsets("topics,data_explroer", "from CLI"),
    /Unknown built-in toolset 'data_explroer'/
  );
  assert.throws(
    () => parseBuiltinToolsets(" , ", "from CLI"),
    /Select at least one built-in toolset/
  );
  assert.throws(
    () => parseBuiltinToolsets(true, "from CLI"),
    /expected a comma-separated string or string array.*data_explorer/
  );
  assert.throws(
    () => parseBuiltinToolsets(["topics", 1], "from profile"),
    /Invalid toolsets from profile/
  );
});
