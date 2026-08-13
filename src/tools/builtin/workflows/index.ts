import type { ToolDefinition } from "../../definition.js";
import { listWorkflowsTool } from "./list_workflows.js";
import { getWorkflowTool } from "./get_workflow.js";
import { listWorkflowNodeTypesTool } from "./list_node_types.js";
import { resolveWorkflowEntityTool } from "./resolve_entity.js";
import { listWorkflowTemplatesTool } from "./list_templates.js";
import { listWorkflowExecutionsTool } from "./list_executions.js";
import { getWorkflowExecutionTool } from "./get_execution.js";
import { listWorkflowVersionsTool } from "./list_versions.js";
import { listWorkflowCredentialsTool } from "./list_credentials.js";
import { evaluateWorkflowExpressionTool } from "./evaluate_expression.js";
import { createWorkflowTool } from "./create_workflow.js";
import { updateWorkflowTool } from "./update_workflow.js";
import { deleteWorkflowTool } from "./delete_workflow.js";
import { discardWorkflowDraftTool } from "./discard_draft.js";
import { restoreWorkflowVersionTool } from "./restore_version.js";
import { runWorkflowTool } from "./run_workflow.js";
import { runWorkflowStepTool } from "./run_workflow_step.js";
import { updateWorkflowPinDataTool } from "./update_pin_data.js";

export const workflowTools = [
  listWorkflowsTool, getWorkflowTool, listWorkflowNodeTypesTool, resolveWorkflowEntityTool,
  listWorkflowTemplatesTool, listWorkflowExecutionsTool, getWorkflowExecutionTool,
  listWorkflowVersionsTool, listWorkflowCredentialsTool, evaluateWorkflowExpressionTool,
  createWorkflowTool, updateWorkflowTool, deleteWorkflowTool, discardWorkflowDraftTool,
  restoreWorkflowVersionTool, runWorkflowTool, runWorkflowStepTool, updateWorkflowPinDataTool,
] as const satisfies readonly ToolDefinition[];
