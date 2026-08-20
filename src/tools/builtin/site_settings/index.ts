import type { ToolDefinition } from "../../definition.js";
import { listSiteSettingsTool } from "../administration/list_site_settings.js";
import { updateSiteSettingTool } from "./update_site_setting.js";

export { listSiteSettingsTool, updateSiteSettingTool };
// The dual-membership read remains in administrationTools to preserve its stable
// catalog position; this collection contributes only the new mutation.
export const siteSettingTools = [updateSiteSettingTool] as const satisfies readonly ToolDefinition[];
