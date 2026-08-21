import type { ToolDefinition } from "../../definition.js";
import { listThemesTool } from "./list_themes.js";
import { getThemeTool } from "./get_theme.js";
import { createThemeTool } from "./create_theme.js";
import { installThemeTool } from "./install_theme.js";
import { updateThemeTool } from "./update_theme.js";
import { updateThemeFieldsTool } from "./update_theme_fields.js";
import { updateThemeSettingTool } from "./update_theme_setting.js";
import { updateThemeTranslationsTool } from "./update_theme_translations.js";
import { syncRemoteThemeTool } from "./sync_remote_theme.js";
import { uploadThemeAssetTool } from "./upload_theme_asset.js";
import { deleteThemeTool } from "./delete_theme.js";

/** Opt-in administrative theme tools in stable registration order. */
export const themeTools = [
  listThemesTool,
  getThemeTool,
  createThemeTool,
  installThemeTool,
  updateThemeTool,
  updateThemeFieldsTool,
  updateThemeSettingTool,
  updateThemeTranslationsTool,
  syncRemoteThemeTool,
  uploadThemeAssetTool,
  deleteThemeTool,
] as const satisfies readonly ToolDefinition[];
