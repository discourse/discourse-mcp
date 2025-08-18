#!/usr/bin/env node
/*
  Sync Discourse fixtures from try.discourse.org.
  Writes JSON files under fixtures/try and a manifest.json for tests.
*/

import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE = process.env.DISCOURSE_SITE || "https://try.discourse.org";
const OUT_DIR = path.resolve(__dirname, "../fixtures/try");

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const manifest = { topics: [], posts: [], users: [], queries: [] };

  // site.json
  await fetchAndSave("/site.json", "site.json");

  // tags.json (may be empty on some sites)
  await fetchAndSave("/tags.json", "tags.json");

  // latest topics
  const latest = await fetchJson("/latest.json");
  const topics = Array.isArray(latest?.topic_list?.topics)
    ? latest.topic_list.topics.slice(0, 5)
    : [];
  for (const t of topics) {
    const topicId = t.id;
    const topicFile = `t_${topicId}.json`;
    const topic = await fetchAndSave(`/t/${topicId}.json`, topicFile);
    if (topicId) manifest.topics.push(topicId);
    const firstPostId = topic?.post_stream?.posts?.[0]?.id;
    if (firstPostId) {
      await fetchAndSave(
        `/posts/${firstPostId}.json`,
        `post_${firstPostId}.json`,
      );
      manifest.posts.push(firstPostId);
    }
  }

  // directory users – pick up to 3
  try {
    const dir = await fetchJson(
      "/directory_items.json?period=all&order=likes_received",
    );
    const items = Array.isArray(dir?.directory_items)
      ? dir.directory_items.slice(0, 3)
      : [];
    for (const it of items) {
      const username = it?.user?.username;
      if (!username) continue;
      await fetchAndSave(
        `/u/${encodeURIComponent(username)}.json`,
        `u_${username}.json`,
      );
      manifest.users.push(username);
    }
  } catch (e) {
    // ignore directory errors
  }

  // search queries
  const queries = ["discourse", "welcome"];
  for (const q of queries) {
    const url = `/search.json?expanded=true&q=${encodeURIComponent(q)}`;
    await fetchAndSave(url, `search_${encodeURIComponent(q)}.json`);
    manifest.queries.push(q);
  }

  await writeFile(
    path.join(OUT_DIR, "manifest.json"),
    JSON.stringify(manifest, null, 2),
  );
  process.stderr.write(`[sync-fixtures] Wrote fixtures to ${OUT_DIR}\n`);
}

async function fetchAndSave(p, filename) {
  const data = await fetchJson(p);
  await writeFile(path.join(OUT_DIR, filename), JSON.stringify(data, null, 2));
  return data;
}

async function fetchJson(p) {
  const url = new URL(p, BASE).toString();
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Discourse-MCP-Fixtures/0.x",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

if (import.meta.url === `file://${__filename}`) {
  main().catch((err) => {
    process.stderr.write(
      `[sync-fixtures] ERROR ${err?.message || String(err)}\n`,
    );
    process.exit(1);
  });
}
