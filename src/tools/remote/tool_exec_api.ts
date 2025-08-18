import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { HttpClient } from "../../http/client.js";
import type { Logger } from "../../util/logger.js";

type RemoteTool = {
  name: string;
  description?: string;
  inputSchema?: any;
};

export async function tryRegisterRemoteTools(
  server: McpServer,
  client: HttpClient,
  logger: Logger,
  siteBase: string
) {
  try {
    const tools = (await client.get(`/ai/tools`)) as RemoteTool[] | { tools: RemoteTool[] };
    const list = Array.isArray(tools) ? tools : tools?.tools || [];
    if (!Array.isArray(list) || list.length === 0) return;

    const usedNames = new Set<string>();

    const makeSafeName = (rawName: string | undefined): string => {
      const base = (rawName && typeof rawName === 'string' ? rawName : 'tool').trim();
      // Replace any disallowed chars (including dots/spaces) with underscore
      let safe = base.replace(/[^a-zA-Z0-9_-]/g, "_");
      // Prefix with remote_ to avoid collisions and make origin clear
      if (!safe.startsWith("remote_")) safe = `remote_${safe}`;
      // Collapse consecutive underscores
      safe = safe.replace(/_+/g, "_");
      // Enforce max length 128
      if (safe.length > 128) safe = safe.slice(0, 128);
      if (!safe) safe = "remote_tool";
      // Ensure uniqueness
      let candidate = safe;
      let suffix = 2;
      while (usedNames.has(candidate)) {
        const extra = `_${suffix}`;
        candidate = safe.slice(0, Math.max(1, 128 - extra.length)) + extra;
        suffix++;
      }
      usedNames.add(candidate);
      return candidate;
    };

    for (const t of list) {
      const safeName = makeSafeName(t.name);
      const schema = jsonSchemaToZod(t.inputSchema) ?? z.object({}).strict();
      server.registerTool(
        safeName,
        {
          title: t.name,
          description: t.description || "",
          inputSchema: (schema as z.ZodObject<any>).shape ?? {},
        },
        async (args: any, _extra: any) => {
          try {
            const res = (await client.post(`/ai/tools/${encodeURIComponent(t.name)}/call`, {
              arguments: args,
              context: {},
            })) as any;
            const result = res?.result ?? res;
            const details = res?.details;
            const links = extractLinks(details);
            const lines = [String(result || "")];
            if (links.length) {
              lines.push("\nArtifacts:");
              for (const l of links) lines.push(`- [${l.name || l.url}](${l.url})`);
            }
            return { content: [{ type: "text", text: lines.join("\n") }] };
          } catch (e: any) {
            return { content: [{ type: "text", text: `Remote tool ${t.name} failed: ${e?.message || String(e)}` }], isError: true };
          }
        }
      );
    }
    logger.info(`Registered ${list.length} remote tool(s) from Tool Execution API.`);
  } catch (e: any) {
    logger.debug(`No Tool Execution API detected: ${e?.message || String(e)}`);
  }
}

function extractLinks(details: any): Array<{ url: string; name?: string }> {
  const items: Array<{ url: string; name?: string }> = [];
  if (!details) return items;
  const push = (x: any) => {
    if (x && typeof x.url === "string") items.push({ url: x.url, name: x.name });
  };
  if (Array.isArray(details?.artifacts)) details.artifacts.forEach(push);
  return items;
}

function jsonSchemaToZod(schema: any): z.ZodTypeAny | undefined {
  if (!schema || typeof schema !== "object") return undefined;
  if (schema.type === "object" && schema.properties) {
    const shape: Record<string, z.ZodTypeAny> = {};
    const req: string[] = Array.isArray(schema.required) ? schema.required : [];
    for (const [k, v] of Object.entries<any>(schema.properties)) {
      let zt: z.ZodTypeAny | undefined;
      if (v.type === "string") zt = z.string();
      else if (v.type === "number") zt = z.number();
      else if (v.type === "integer") zt = z.number().int();
      else if (v.type === "boolean") zt = z.boolean();
      else if (v.type === "object" && v.properties) zt = jsonSchemaToZod(v) as any;
      else if (v.type === "array" && v.items) {
        const inner = jsonSchemaToZod(v.items) || z.any();
        zt = z.array(inner);
      } else {
        zt = z.any();
      }
      if (v.description && zt && (zt as any).describe) {
        zt = (zt as any).describe(v.description);
      }
      if (!req.includes(k)) zt = (zt as z.ZodTypeAny).optional();
      shape[k] = zt as z.ZodTypeAny;
    }
    return z.object(shape);
  }
  // primitives
  if (schema.type === "string") return z.string();
  if (schema.type === "number") return z.number();
  if (schema.type === "integer") return z.number().int();
  if (schema.type === "boolean") return z.boolean();
  return undefined;
}

