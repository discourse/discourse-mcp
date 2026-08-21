import { z } from "zod";
import type { HttpClient } from "../../../http/client.js";

function hasUnsafeRecipientCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return character === "," || code <= 31 || (code >= 127 && code <= 159);
  });
}

function recipientValue(label: string, allowAt: boolean) {
  return z.string().transform((value) => value.trim()).pipe(
    z.string()
      .min(1, `${label} cannot be blank`)
      .refine((value) => !hasUnsafeRecipientCharacter(value), `${label} cannot contain commas or control characters`)
      .refine((value) => allowAt || !value.includes("@"), `${label} cannot contain @`),
  );
}

export const usernameSchema = recipientValue("Username", false);
export const groupNameSchema = recipientValue("Group name", false);
export const emailAddressSchema = recipientValue("Email address", true).pipe(z.string().email("Invalid email address"));
export const optionalAuthorUsernameSchema = z.string().transform((value) => value.trim()).pipe(z.string().min(1)).optional();

export function actingUserHeaders(authorUsername?: string): Record<string, string> {
  return authorUsername ? { "Api-Username": authorUsername } : {};
}

export function deduplicateRecipients(groups: readonly string[][]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const values of groups) {
    for (const value of values) {
      const key = value.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        result.push(value);
      }
    }
  }
  return result;
}

export async function resolveCurrentUsername(client: HttpClient): Promise<string> {
  const data = (await client.get("/session/current.json")) as any;
  const username = data?.current_user?.username;
  if (typeof username !== "string" || username.trim().length === 0) {
    throw new Error("Authenticated session did not return a current username");
  }
  return username.trim();
}

export function assertPrivateMessage(data: any): void {
  if (data?.archetype !== "private_message") {
    throw new Error("Topic is not a private message");
  }
}

export function normalizeUser(user: any) {
  return {
    id: user?.id,
    username: user?.username || "",
    name: user?.name ?? null,
  };
}

export function normalizeGroup(group: any) {
  return {
    id: group?.id,
    name: group?.name || "",
  };
}

export function normalizeRecentParticipants(participants: unknown) {
  if (!Array.isArray(participants)) return [];
  return participants
    .map((participant: any) => participant?.user)
    .filter((user: any) => user && typeof user.username === "string")
    .map(normalizeUser);
}

export function normalizePostResult(data: any, fallbackTopicId?: number) {
  const post = data?.post ?? data;
  return {
    id: post?.id,
    topic_id: post?.topic_id ?? data?.topic_id ?? fallbackTopicId,
    post_number: post?.post_number ?? data?.post_number,
    slug: post?.topic_slug ?? data?.topic_slug ?? data?.slug ?? null,
    username: post?.username ?? data?.username ?? null,
  };
}
