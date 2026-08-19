import type { ToolDefinition } from "../../definition.js";
import { listReportsTool } from "./list_reports.js";
import { getReportTool } from "./get_report.js";
import { getSupportDashboardTool } from "./get_support_dashboard.js";

export { listReportsTool, getReportTool, getSupportDashboardTool };
export const analyticsTools = [listReportsTool, getReportTool, getSupportDashboardTool] as const satisfies readonly ToolDefinition[];
