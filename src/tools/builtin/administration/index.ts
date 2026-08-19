import type { ToolDefinition } from "../../definition.js";
import { listCategoriesTool } from "./list_categories.js";
import { listSiteSettingsTool } from "./list_site_settings.js";
import { manageUserActivationTool } from "./manage_user_activation.js";

export { listCategoriesTool, listSiteSettingsTool, manageUserActivationTool };
export const administrationTools = [listCategoriesTool, listSiteSettingsTool, manageUserActivationTool] as const satisfies readonly ToolDefinition[];
