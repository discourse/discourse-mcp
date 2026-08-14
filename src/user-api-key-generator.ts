#!/usr/bin/env node
import { constants, generateKeyPairSync, privateDecrypt, randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";

interface KeyPair {
  publicKey: string;
  privateKey: string;
}

export interface GenerateOptions {
  site: string;
  scopes?: string;
  applicationName?: string;
  clientId?: string;
  nonce?: string;
  payload?: string;
  saveTo?: string;
}

export interface DeviceAuthorization {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriWithRequest?: string;
  expiresIn: number;
  interval: number;
}

interface DecryptedPayload {
  key: string;
  nonce: string;
  push?: boolean;
  api?: number;
  expires_at?: string;
}

type Fetch = typeof fetch;
type Sleep = (milliseconds: number) => Promise<void>;

const DEFAULT_APPLICATION_NAME = "Discourse MCP";
const DEFAULT_CLIENT_ID = "discourse-mcp";
const DEFAULT_SCOPES = "read,write";
const DEVICE_AUTH_HEADER = "Auth-Api-Device-Code";

function siteUrl(site: string, path: string): URL {
  return new URL(`${site.replace(/\/+$/, "")}${path}`);
}

function generateKeyPair(): KeyPair {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: {
      type: "spki",
      format: "pem",
    },
    privateKeyEncoding: {
      type: "pkcs8",
      format: "pem",
    },
  });

  return { publicKey, privateKey };
}

export function buildAuthorizationUrl(
  options: GenerateOptions,
  publicKey: string,
  nonce: string
): string {
  const url = siteUrl(options.site, "/user-api-key/new");
  url.search = new URLSearchParams({
    application_name: options.applicationName || DEFAULT_APPLICATION_NAME,
    client_id: options.clientId || DEFAULT_CLIENT_ID,
    scopes: options.scopes || DEFAULT_SCOPES,
    public_key: publicKey,
    nonce,
  }).toString();
  return url.toString();
}

export function decryptPayload(
  encryptedPayload: string,
  privateKey: string,
  padding: "pkcs1" | "oaep"
): DecryptedPayload {
  try {
    const buffer = Buffer.from(encryptedPayload, "base64");
    const decrypted = privateDecrypt(
      {
        key: privateKey,
        padding:
          padding === "oaep" ? constants.RSA_PKCS1_OAEP_PADDING : constants.RSA_PKCS1_PADDING,
      },
      buffer
    );
    const result = JSON.parse(decrypted.toString("utf8")) as Partial<DecryptedPayload>;
    if (typeof result.key !== "string" || !result.key) {
      throw new Error("missing 'key' field");
    }
    if (typeof result.nonce !== "string") {
      throw new Error("missing 'nonce' field");
    }
    return result as DecryptedPayload;
  } catch (error: any) {
    throw new Error(`Failed to decrypt payload: ${error?.message || String(error)}`);
  }
}

async function responseError(response: Response): Promise<Error> {
  const body = await response.text().catch(() => "");
  const detail = body ? `: ${body}` : "";
  return new Error(`Request failed with HTTP ${response.status}${detail}`);
}

export async function supportsDeviceAuthorization(
  site: string,
  fetchImpl: Fetch = fetch
): Promise<boolean> {
  const response = await fetchImpl(siteUrl(site, "/user-api-key/new"), { method: "HEAD" });
  if (response.status === 404 || response.status === 405) return false;
  if (!response.ok) throw await responseError(response);
  return response.headers.get(DEVICE_AUTH_HEADER)?.toLowerCase() === "true";
}

export async function createDeviceAuthorization(
  options: GenerateOptions,
  publicKey: string,
  nonce: string,
  fetchImpl: Fetch = fetch
): Promise<DeviceAuthorization> {
  const response = await fetchImpl(siteUrl(options.site, "/user-api-key/device.json"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      application_name: options.applicationName || DEFAULT_APPLICATION_NAME,
      client_id: options.clientId || DEFAULT_CLIENT_ID,
      scopes: options.scopes || DEFAULT_SCOPES,
      public_key: publicKey,
      nonce,
      padding: "oaep",
    }),
  });
  if (!response.ok) throw await responseError(response);

  const body = (await response.json()) as Record<string, unknown>;
  const validVerificationUri =
    typeof body.verification_uri === "string" && URL.canParse(body.verification_uri);
  const validRequestUri =
    body.verification_uri_with_request === undefined ||
    (typeof body.verification_uri_with_request === "string" &&
      URL.canParse(body.verification_uri_with_request));
  if (
    typeof body.device_code !== "string" ||
    !/^[a-f\d]{64}$/i.test(body.device_code) ||
    typeof body.user_code !== "string" ||
    !/^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(body.user_code) ||
    !validVerificationUri ||
    !validRequestUri ||
    typeof body.expires_in !== "number" ||
    !Number.isFinite(body.expires_in) ||
    body.expires_in <= 0 ||
    typeof body.interval !== "number" ||
    !Number.isFinite(body.interval) ||
    body.interval <= 0
  ) {
    throw new Error("Invalid device authorization response");
  }

  return {
    deviceCode: body.device_code,
    userCode: body.user_code,
    verificationUri: body.verification_uri as string,
    verificationUriWithRequest:
      typeof body.verification_uri_with_request === "string"
        ? body.verification_uri_with_request
        : undefined,
    expiresIn: body.expires_in,
    interval: body.interval,
  };
}

export async function pollDeviceAuthorization(
  site: string,
  authorization: DeviceAuthorization,
  fetchImpl: Fetch = fetch,
  sleep: Sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
): Promise<string> {
  const deadline = Date.now() + authorization.expiresIn * 1000;
  const interval = Math.max(1, authorization.interval) * 1000;

  while (Date.now() < deadline) {
    const response = await fetchImpl(siteUrl(site, "/user-api-key/device/poll.json"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_code: authorization.deviceCode }),
    });
    if (!response.ok) throw await responseError(response);

    const body = (await response.json()) as Record<string, unknown>;
    switch (body.status) {
      case "authorization_pending":
        await sleep(interval);
        break;
      case "authorized":
        if (typeof body.payload !== "string" || !body.payload) {
          throw new Error("Invalid authorized response: missing payload");
        }
        return body.payload;
      case "access_denied":
        throw new Error("The authorization request was denied");
      case "expired_token":
        throw new Error("The authorization request expired");
      default:
        throw new Error(`Unexpected device authorization status: ${String(body.status)}`);
    }
  }

  throw new Error("Timed out waiting for authorization");
}

async function promptForInput(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function saveToProfile(
  profilePath: string,
  site: string,
  userApiKey: string,
  clientId: string
): Promise<void> {
  let profile: any = {};

  try {
    const content = await readFile(profilePath, "utf8");
    profile = JSON.parse(content);
  } catch {
    // File doesn't exist or is invalid, start fresh
  }

  if (!profile.auth_pairs) {
    profile.auth_pairs = [];
  }

  // Remove any existing entry for this site
  profile.auth_pairs = profile.auth_pairs.filter((pair: any) => pair.site !== site);

  // Add new entry
  profile.auth_pairs.push({
    site,
    user_api_key: userApiKey,
    user_api_client_id: clientId,
  });

  await writeFile(profilePath, JSON.stringify(profile, null, 2), "utf8");
}

async function getLegacyPayload(
  options: GenerateOptions,
  publicKey: string,
  nonce: string
): Promise<string> {
  const authUrl = buildAuthorizationUrl(options, publicKey, nonce);
  console.error("This Discourse site does not support device authorization.");
  console.error("Please visit this URL to authorize the application:\n");
  console.error(authUrl);
  console.error("");

  if (options.payload) return options.payload;

  console.error("After authorizing, copy the encrypted payload displayed by Discourse.\n");
  const payload = await promptForInput("Paste the encrypted payload here: ");
  if (!payload) throw new Error("No payload provided");
  return payload;
}

export async function generateUserApiKey(options: GenerateOptions): Promise<void> {
  if (!options.site) {
    console.error(`
Usage: discourse-mcp generate-user-api-key [options]

Options:
  --site <url>              Discourse site URL (required)
  --scopes <scopes>         Comma-separated scopes (default: read,write)
  --application-name <name> Application name (default: Discourse MCP)
  --client-id <id>          Client ID (default: discourse-mcp)
  --nonce <nonce>           Nonce for request (default: random)
  --payload <payload>       Use a legacy encrypted payload directly
  --save-to <file>          Save to profile file instead of printing
  --help, -h                Show this help message

Examples:
  discourse-mcp generate-user-api-key --site https://discourse.example.com
  discourse-mcp generate-user-api-key --site https://discourse.example.com --save-to profile.json
`);
    process.exit(1);
  }

  console.error("\n🔑 Discourse User API Key Generator\n");
  console.error(`Site: ${options.site}`);
  console.error(`Scopes: ${options.scopes || DEFAULT_SCOPES}\n`);
  console.error("Generating RSA key pair...");
  const { publicKey, privateKey } = generateKeyPair();
  const nonce = options.nonce || randomBytes(32).toString("hex");
  console.error("✓ Key pair generated\n");

  let encryptedPayload: string;
  let padding: "pkcs1" | "oaep";

  if (!options.payload && (await supportsDeviceAuthorization(options.site))) {
    console.error("Requesting device authorization...");
    const authorization = await createDeviceAuthorization(options, publicKey, nonce);
    const verificationUri =
      authorization.verificationUriWithRequest || authorization.verificationUri;
    console.error("\nOpen this URL in your browser:\n");
    console.error(verificationUri);
    console.error(`\nEnter this code when prompted: ${authorization.userCode}`);
    console.error("\nWaiting for authorization...");
    encryptedPayload = await pollDeviceAuthorization(options.site, authorization);
    padding = "oaep";
  } else {
    encryptedPayload = await getLegacyPayload(options, publicKey, nonce);
    padding = "pkcs1";
  }

  console.error("\nDecrypting payload...");
  const result = decryptPayload(encryptedPayload, privateKey, padding);
  if (result.nonce !== nonce) {
    throw new Error("Invalid response: nonce did not match the authorization request");
  }
  console.error("✓ User API Key retrieved successfully\n");

  const clientId = options.clientId || DEFAULT_CLIENT_ID;
  if (options.saveTo) {
    await saveToProfile(options.saveTo, options.site, result.key, clientId);
    console.error(`✓ Saved to profile: ${options.saveTo}\n`);
    console.log(JSON.stringify({ success: true, profile: options.saveTo }, null, 2));
  } else {
    console.error("Add this to your auth_pairs configuration:\n");
    console.log(
      JSON.stringify(
        {
          site: options.site,
          user_api_key: result.key,
          user_api_client_id: clientId,
        },
        null,
        2
      )
    );
    console.error("\nOr use --save-to <profile.json> to save automatically.");
  }
}

async function main() {
  const args = process.argv.slice(2);
  const options: GenerateOptions = { site: "" };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    switch (arg) {
      case "--site":
        options.site = next;
        i++;
        break;
      case "--scopes":
        options.scopes = next;
        i++;
        break;
      case "--application-name":
        options.applicationName = next;
        i++;
        break;
      case "--client-id":
        options.clientId = next;
        i++;
        break;
      case "--nonce":
        options.nonce = next;
        i++;
        break;
      case "--payload":
        options.payload = next;
        i++;
        break;
      case "--save-to":
        options.saveTo = next;
        i++;
        break;
    }
  }

  try {
    await generateUserApiKey(options);
  } catch (error: any) {
    console.error(`\n❌ Error: ${error?.message || String(error)}`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`Fatal error: ${error}`);
    process.exit(1);
  });
}
