import { randomUUID } from "node:crypto";
import { z } from "zod";

export const workflowNodeSchema = z.object({
  id: z.string().optional(),
  type: z.string().min(1),
  name: z.string().min(1),
  parameters: z.record(z.unknown()).optional(),
  credentials: z.record(z.unknown()).optional(),
  position: z.unknown().optional(),
}).passthrough();

export type WorkflowNode = z.infer<typeof workflowNodeSchema>;

export const flatConnectionSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  type: z.string().min(1).default("main"),
  output_index: z.number().int().nonnegative().default(0),
  input_index: z.number().int().nonnegative().default(0),
});

export type FlatConnection = z.infer<typeof flatConnectionSchema>;
export type NestedConnections = Record<string, Record<string, Array<Array<{ node: string; type: string; index: number }>>>>;

export const connectionsSchema = z.union([
  z.array(flatConnectionSchema),
  z.record(z.record(z.array(z.array(z.object({
    node: z.string(),
    type: z.string(),
    index: z.number().int().nonnegative(),
  }).passthrough())))),
]);

const nodeRefFields = {
  id: z.string().optional(),
  name: z.string().optional(),
};

export const workflowOperationSchema = z.union([
  z.object({ op: z.literal("add_node"), id: z.string().optional(), node: workflowNodeSchema }),
  z.object({ op: z.literal("update_node_parameters"), parameters: z.record(z.unknown()), ...nodeRefFields })
    .refine((value) => Boolean(value.id || value.name), "Provide id or name"),
  z.object({ op: z.literal("rename_node"), name: z.string().min(1), id: z.string().optional(), current_name: z.string().optional() })
    .refine((value) => Boolean(value.id || value.current_name), "Provide id or current_name"),
  z.object({ op: z.literal("remove_node"), ...nodeRefFields })
    .refine((value) => Boolean(value.id || value.name), "Provide id or name"),
  z.object({ op: z.literal("add_connection") }).merge(flatConnectionSchema.partial({ type: true, output_index: true, input_index: true }).required({ from: true, to: true })),
  z.object({
    op: z.literal("remove_connection"),
    from: z.string().min(1),
    to: z.string().min(1),
    type: z.string().min(1).optional(),
    output_index: z.number().int().nonnegative().optional(),
    input_index: z.number().int().nonnegative().optional(),
  }),
]);

export type WorkflowOperation = z.infer<typeof workflowOperationSchema>;

export function assertPairedGraph(nodes: unknown, connections: unknown): void {
  if ((nodes === undefined) !== (connections === undefined)) {
    throw new Error("nodes and connections must be provided together");
  }
}

export function toNestedConnections(value: NestedConnections | FlatConnection[]): NestedConnections {
  if (!Array.isArray(value)) return structuredClone(value);
  const nested: NestedConnections = {};
  for (const raw of value) {
    const edge = flatConnectionSchema.parse(raw);
    const groups = (nested[edge.from] ??= {})[edge.type] ??= [];
    while (groups.length <= edge.output_index) groups.push([]);
    groups[edge.output_index].push({ node: edge.to, type: "main", index: edge.input_index });
  }
  return nested;
}

export function toConnectionList(value: NestedConnections): FlatConnection[] {
  const result: FlatConnection[] = [];
  for (const [from, ports] of Object.entries(value ?? {})) {
    for (const [type, groups] of Object.entries(ports ?? {})) {
      groups.forEach((edges, output_index) => {
        for (const edge of edges ?? []) {
          result.push({ from, to: edge.node, type, output_index, input_index: edge.index ?? 0 });
        }
      });
    }
  }
  return result;
}

function resolveNode(nodes: WorkflowNode[], reference: string): WorkflowNode {
  const matches = nodes.filter((node) => node.id === reference || node.name === reference);
  if (matches.length !== 1) throw new Error(`Could not uniquely resolve workflow node '${reference}'`);
  return matches[0];
}

export function applyWorkflowOperations(
  sourceNodes: WorkflowNode[],
  sourceConnections: NestedConnections,
  operations: WorkflowOperation[],
): { nodes: WorkflowNode[]; connections: NestedConnections } {
  const nodes = structuredClone(sourceNodes);
  let flat = toConnectionList(sourceConnections);

  for (const operation of operations) {
    switch (operation.op) {
      case "add_node": {
        const node = structuredClone(operation.node);
        node.id = operation.id ?? node.id ?? randomUUID();
        if (nodes.some((existing) => existing.id === node.id || existing.name === node.name)) {
          throw new Error(`Workflow node id or name already exists: '${node.name}'`);
        }
        nodes.push(node);
        break;
      }
      case "update_node_parameters": {
        const node = operation.id ? resolveNode(nodes, operation.id) : resolveNode(nodes, operation.name!);
        node.parameters = { ...(node.parameters ?? {}), ...operation.parameters };
        break;
      }
      case "rename_node": {
        const node = operation.id ? resolveNode(nodes, operation.id) : resolveNode(nodes, operation.current_name!);
        if (nodes.some((other) => other !== node && other.name === operation.name)) throw new Error(`Workflow node name already exists: '${operation.name}'`);
        const oldName = node.name;
        node.name = operation.name;
        flat = flat.map((edge) => ({
          ...edge,
          from: edge.from === oldName ? operation.name : edge.from,
          to: edge.to === oldName ? operation.name : edge.to,
        }));
        break;
      }
      case "remove_node": {
        const node = operation.id ? resolveNode(nodes, operation.id) : resolveNode(nodes, operation.name!);
        nodes.splice(nodes.indexOf(node), 1);
        flat = flat.filter((edge) => edge.from !== node.name && edge.to !== node.name);
        break;
      }
      case "add_connection": {
        const from = resolveNode(nodes, operation.from).name;
        const to = resolveNode(nodes, operation.to).name;
        flat.push({
          from,
          to,
          type: operation.type ?? "main",
          output_index: operation.output_index ?? 0,
          input_index: operation.input_index ?? 0,
        });
        break;
      }
      case "remove_connection": {
        const from = resolveNode(nodes, operation.from).name;
        const to = resolveNode(nodes, operation.to).name;
        flat = flat.filter((edge) => !(edge.from === from && edge.to === to
          && (operation.type === undefined || edge.type === operation.type)
          && (operation.output_index === undefined || edge.output_index === operation.output_index)
          && (operation.input_index === undefined || edge.input_index === operation.input_index)));
        break;
      }
    }
  }

  return { nodes, connections: toNestedConnections(flat) };
}
