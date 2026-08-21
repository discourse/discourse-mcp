import test from "node:test";
import assert from "node:assert/strict";
import { applyWorkflowOperations, assertPairedGraph, toConnectionList, toNestedConnections } from "../tools/builtin/workflows/graph.js";

test("flat workflow connections convert to nested wire format and round trip", () => {
  const nested = toNestedConnections([{ from: "Start", to: "Check", type: "main", output_index: 0, input_index: 0 }]);
  assert.deepEqual(nested, { Start: { main: [[{ node: "Check", type: "main", index: 0 }]] } });
  assert.deepEqual(toConnectionList(nested), [{ from: "Start", to: "Check", type: "main", output_index: 0, input_index: 0 }]);
});

test("workflow graph fields must be paired", () => {
  assert.throws(() => assertPairedGraph([], undefined), /provided together/);
  assert.throws(() => assertPairedGraph(undefined, {}), /provided together/);
  assert.doesNotThrow(() => assertPairedGraph([], {}));
  assert.doesNotThrow(() => assertPairedGraph(undefined, undefined));
});

test("workflow operations add, connect, and rename nodes mechanically", () => {
  const result = applyWorkflowOperations(
    [{ id: "a", name: "Start", type: "trigger:manual" }], {},
    [
      { op: "add_node", id: "b", node: { name: "Check", type: "condition:if" } },
      { op: "add_connection", from: "a", to: "b", type: "true" },
      { op: "rename_node", id: "b", name: "Renamed" },
    ],
  );
  assert.equal(result.nodes[1].name, "Renamed");
  assert.deepEqual(toConnectionList(result.connections), [{ from: "Start", to: "Renamed", type: "true", output_index: 0, input_index: 0 }]);
});

test("workflow operations reject unresolved node references", () => {
  assert.throws(() => applyWorkflowOperations([], {}, [{ op: "add_connection", from: "missing", to: "also-missing" }]), /resolve workflow node/);
});
