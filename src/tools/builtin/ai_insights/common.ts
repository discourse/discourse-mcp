import { HttpError } from "../../../http/client.js";
import { pluginError } from "../common/helpers.js";

export function aiInsightError(action: string, error: unknown) {
  if (error instanceof HttpError && error.status === 404) return pluginError(action, "discourse-ai", error);
  return pluginError(action, "discourse-ai", error);
}
