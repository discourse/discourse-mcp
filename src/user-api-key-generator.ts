#!/usr/bin/env node
import { generateKeyPairSync, privateDecrypt, constants } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";

interface KeyPair {
  publicKey: string;
  privateKey: string;
}

interface GenerateOptions {
  site: string;
  scopes?: string;
  applicationName?: string;
  clientId?: string;
  nonce?: string;
  payload?: string;
  saveTo?: string;
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

function buildAuthorizationUrl(options: GenerateOptions, publicKey: string): string {
  const url = new URL(`${options.site}/user-api-key/new`);

  const params = new URLSearchParams({
    application_name: options.applicationName || "Discourse MCP",
    client_id: options.clientId || "discourse-mcp",
    scopes: options.scopes || "read,write",
    public_key: publicKey,
    nonce: options.nonce || Date.now().toString(),
  });

  url.search = params.toString();
  return url.toString();
}

function decryptPayload(encryptedPayload: string, privateKey: string): string {
  try {
    const buffer = Buffer.from(encryptedPayload, "base64");
    const decrypted = privateDecrypt(
      {
        key: privateKey,
        padding: constants.RSA_PKCS1_PADDING,
      },
      buffer
    );
    return decrypted.toString("utf8");
  } catch (error: any) {
    throw new Error(`Failed to decrypt payload: ${error?.message || String(error)}`);
  }
}

async function promptForInput(question: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

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
  profile.auth_pairs = profile.auth_pairs.filter((p: any) => p.site !== site);

  // Add new entry
  profile.auth_pairs.push({
    site,
    user_api_key: userApiKey,
    user_api_client_id: clientId,
  });

  await writeFile(profilePath, JSON.stringify(profile, null, 2), "utf8");
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
  --nonce <nonce>           Nonce for request (default: timestamp)
  --payload <payload>       Encrypted payload (skip interactive prompt)
  --save-to <file>          Save to profile file instead of printing
  --help, -h                Show this help message

Examples:
  # Interactive mode
  discourse-mcp generate-user-api-key --site https://discourse.example.com

  # Save to profile
  discourse-mcp generate-user-api-key --site https://discourse.example.com --save-to profile.json

  # Non-interactive with payload
  discourse-mcp generate-user-api-key --site https://discourse.example.com --payload "base64..."
`);
    process.exit(1);
  }

  console.error("\n🔑 Discourse User API Key Generator\n");
  console.error(`Site: ${options.site}`);
  console.error(`Scopes: ${options.scopes || "read,write"}\n`);

  // Step 1: Generate RSA keypair
  console.error("Generating RSA key pair...");
  const { publicKey, privateKey } = generateKeyPair();
  console.error("✓ Key pair generated\n");

  // Step 2: Build authorization URL
  const authUrl = buildAuthorizationUrl(options, publicKey);
  console.error("Please visit this URL to authorize the application:\n");
  console.error(authUrl);
  console.error("");

  // Step 3: Get encrypted payload
  let encryptedPayload: string;
  if (options.payload) {
    encryptedPayload = options.payload;
  } else {
    console.error("After authorizing, you will be redirected to a URL like:");
    console.error("  discourse://auth_redirect?payload=<encrypted_payload>");
    console.error("\nOr you may see the encrypted payload displayed on the page.\n");

    encryptedPayload = await promptForInput("Paste the encrypted payload here: ");

    if (!encryptedPayload) {
      throw new Error("No payload provided");
    }
  }

  // Step 4: Decrypt payload
  console.error("\nDecrypting payload...");
  const decrypted = decryptPayload(encryptedPayload, privateKey);
  const result = JSON.parse(decrypted);

  if (!result.key) {
    throw new Error("Invalid response: missing 'key' field");
  }

  console.error("✓ User API Key retrieved successfully\n");

  // Step 5: Output or save
  const clientId = options.clientId || "discourse-mcp";

  if (options.saveTo) {
    await saveToProfile(options.saveTo, options.site, result.key, clientId);
    console.error(`✓ Saved to profile: ${options.saveTo}\n`);
    console.log(JSON.stringify({ success: true, profile: options.saveTo }, null, 2));
  } else {
    console.error("Add this to your auth_pairs configuration:\n");
    console.log(JSON.stringify({
      site: options.site,
      user_api_key: result.key,
      user_api_client_id: clientId,
    }, null, 2));
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
  main().catch((err) => {
    console.error(`Fatal error: ${err}`);
    process.exit(1);
  });
}
