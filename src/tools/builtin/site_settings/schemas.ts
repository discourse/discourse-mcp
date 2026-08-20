import { z } from "zod";
import { settingValueSchema } from "../common/site_setting_values.js";

export const updateSiteSettingSchema = z.object({
  setting: z.string().regex(/^[a-z0-9_]+$/).max(200),
  operation: z.enum(["set", "reset_to_default"]),
  value: settingValueSchema.optional(),
  expected_current_value: settingValueSchema,
  confirm_change: z.literal(true),
  confirm_required_setting: z.literal(true).optional(),
}).strict();
