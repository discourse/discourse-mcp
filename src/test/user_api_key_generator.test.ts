import assert from "node:assert/strict";
import { generateKeyPairSync, publicEncrypt, constants } from "node:crypto";
import test from "node:test";
import {
  buildAuthorizationUrl,
  createDeviceAuthorization,
  decryptPayload,
  pollDeviceAuthorization,
  supportsDeviceAuthorization,
  type GenerateOptions,
} from "../user-api-key-generator.js";

const options: GenerateOptions = {
  site: "https://forum.example/",
  applicationName: "Test CLI",
  clientId: "test-client",
  scopes: "read,write",
};

function mockFetch(
  handler: (url: URL, init?: RequestInit) => Response | Promise<Response>
): typeof fetch {
  return ((input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? new URL(input.url) : new URL(input.toString());
    return Promise.resolve(handler(url, init));
  }) as typeof fetch;
}

test("supportsDeviceAuthorization detects the capability header", async () => {
  const supported = await supportsDeviceAuthorization(
    options.site,
    mockFetch((url, init) => {
      assert.equal(url.toString(), "https://forum.example/user-api-key/new");
      assert.equal(init?.method, "HEAD");
      return new Response(null, { headers: { "Auth-Api-Device-Code": "true" } });
    })
  );

  assert.equal(supported, true);
});

test("supportsDeviceAuthorization falls back when the capability is absent", async () => {
  const supported = await supportsDeviceAuthorization(
    options.site,
    mockFetch(() => new Response(null, { status: 200 }))
  );
  assert.equal(supported, false);
});

test("createDeviceAuthorization sends the device protocol request", async () => {
  const authorization = await createDeviceAuthorization(
    options,
    "PUBLIC KEY",
    "request-nonce",
    mockFetch(async (url, init) => {
      assert.equal(url.toString(), "https://forum.example/user-api-key/device.json");
      assert.equal(init?.method, "POST");
      assert.deepEqual(init?.headers, { "Content-Type": "application/json" });
      assert.deepEqual(JSON.parse(String(init?.body)), {
        application_name: "Test CLI",
        client_id: "test-client",
        scopes: "read,write",
        public_key: "PUBLIC KEY",
        nonce: "request-nonce",
        padding: "oaep",
      });
      return Response.json({
        device_code: "a".repeat(64),
        user_code: "ABCD-2345",
        verification_uri: "https://forum.example/user-api-key/activate",
        verification_uri_with_request:
          "https://forum.example/user-api-key/activate?request=abcd1234",
        expires_in: 600,
        interval: 5,
      });
    })
  );

  assert.deepEqual(authorization, {
    deviceCode: "a".repeat(64),
    userCode: "ABCD-2345",
    verificationUri: "https://forum.example/user-api-key/activate",
    verificationUriWithRequest:
      "https://forum.example/user-api-key/activate?request=abcd1234",
    expiresIn: 600,
    interval: 5,
  });
});

test("createDeviceAuthorization rejects malformed protocol responses", async () => {
  await assert.rejects(
    createDeviceAuthorization(
      options,
      "PUBLIC KEY",
      "request-nonce",
      mockFetch(() =>
        Response.json({
          device_code: "too-short",
          user_code: "1234-5678",
          verification_uri: "not a URL",
          expires_in: 600,
          interval: 5,
        })
      )
    ),
    /Invalid device authorization response/
  );
});

test("pollDeviceAuthorization waits through pending and returns the encrypted payload", async () => {
  const statuses = [
    { status: "authorization_pending" },
    { status: "authorized", payload: "encrypted-result" },
  ];
  const sleeps: number[] = [];
  let requests = 0;

  const payload = await pollDeviceAuthorization(
    options.site,
    {
      deviceCode: "b".repeat(64),
      userCode: "WXYZ-6789",
      verificationUri: "https://forum.example/user-api-key/activate",
      expiresIn: 600,
      interval: 5,
    },
    mockFetch(async (url, init) => {
      assert.equal(url.toString(), "https://forum.example/user-api-key/device/poll.json");
      assert.deepEqual(JSON.parse(String(init?.body)), { device_code: "b".repeat(64) });
      return Response.json(statuses[requests++]);
    }),
    async (milliseconds) => {
      sleeps.push(milliseconds);
    }
  );

  assert.equal(payload, "encrypted-result");
  assert.deepEqual(sleeps, [5000]);
  assert.equal(requests, 2);
});

test("pollDeviceAuthorization reports denial", async () => {
  await assert.rejects(
    pollDeviceAuthorization(
      options.site,
      {
        deviceCode: "c".repeat(64),
        userCode: "ABCD-2345",
        verificationUri: "https://forum.example/user-api-key/activate",
        expiresIn: 600,
        interval: 5,
      },
      mockFetch(() => Response.json({ status: "access_denied" })),
      async () => undefined
    ),
    /authorization request was denied/
  );
});

test("decryptPayload decrypts an OAEP response", () => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const plaintext = JSON.stringify({ key: "secret-key", nonce: "request-nonce", api: 4 });
  const encrypted = publicEncrypt(
    { key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING },
    Buffer.from(plaintext)
  ).toString("base64");

  assert.deepEqual(decryptPayload(encrypted, privateKey, "oaep"), {
    key: "secret-key",
    nonce: "request-nonce",
    api: 4,
  });
});

test("buildAuthorizationUrl preserves the legacy fallback protocol and site subfolder", () => {
  const url = new URL(
    buildAuthorizationUrl({ ...options, site: "https://forum.example/community/" }, "PUBLIC KEY", "request-nonce")
  );

  assert.equal(url.origin, "https://forum.example");
  assert.equal(url.pathname, "/community/user-api-key/new");
  assert.equal(url.searchParams.get("application_name"), "Test CLI");
  assert.equal(url.searchParams.get("client_id"), "test-client");
  assert.equal(url.searchParams.get("scopes"), "read,write");
  assert.equal(url.searchParams.get("public_key"), "PUBLIC KEY");
  assert.equal(url.searchParams.get("nonce"), "request-nonce");
});
