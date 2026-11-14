#!/usr/bin/env node
// One-off migration: copies the original MongoDB data into the site's Netlify Database.
//
// Reads either straight from MongoDB (MONGO_URL + DB_NAME) or from a folder of `mongoexport` files
// (<collection>.json, JSON array or one document per line), then posts the documents to the site's
// admin-only import endpoint. Safe to re-run: documents that were already imported are skipped.
//
//   SITE_URL=https://murraybridgegamesgroup.netlify.app \
//   IMPORT_EMAIL=<admin email> IMPORT_PASSWORD=<admin password> \
//   MONGO_URL=mongodb+srv://... DB_NAME=<database> \
//   npm run import:mongo
//
//   # or, from mongoexport files:
//   npm run import:mongo -- --dir ./mongo-export
import { readFile } from "node:fs/promises";
import path from "node:path";

// Users go last: merging the imported admin account must not log the importer out mid-run.
const ORDER = ["guilds", "collections", "game_logs", "checkins", "payments", "token_uses", "raffle_entries",
  "raffle_bonuses", "quarter_awards", "prizes", "users"];
const CHUNK = 100;

const env = (k) => {
  const v = process.env[k];
  if (!v) {
    console.error(`Missing ${k}. See the usage notes at the top of scripts/import-mongo.mjs`);
    process.exit(1);
  }
  return v;
};

const dirArg = process.argv.indexOf("--dir");
const dir = dirArg > -1 ? process.argv[dirArg + 1] : null;
const site = env("SITE_URL").replace(/\/$/, "");

async function loadFromDir(name) {
  let text;
  try {
    text = await readFile(path.join(dir, `${name}.json`), "utf8");
  } catch {
    return null;
  }
  text = text.trim();
  if (!text) return [];
  return text.startsWith("[") ? JSON.parse(text) : text.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
}

async function loadFromMongo() {
  const { MongoClient } = await import("mongodb");
  const client = new MongoClient(env("MONGO_URL"));
  await client.connect();
  const db = client.db(env("DB_NAME"));
  const data = {};
  for (const name of ORDER) {
    // Dates/ObjectIds become plain JSON (ISO strings / hex) for the HTTP upload.
    data[name] = JSON.parse(JSON.stringify(await db.collection(name).find({}, { projection: { _id: 0 } }).toArray()));
  }
  await client.close();
  return data;
}

async function login() {
  const r = await fetch(`${site}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: env("IMPORT_EMAIL"), password: env("IMPORT_PASSWORD") }) });
  if (!r.ok) throw new Error(`Admin login failed (${r.status}): ${await r.text()}`);
  const cookie = r.headers.getSetCookie().find((c) => c.startsWith("session_token="));
  if (!cookie) throw new Error("Login succeeded but no session cookie was returned");
  return cookie.split(";")[0];
}

const data = dir ? Object.fromEntries(await Promise.all(ORDER.map(async (n) => [n, await loadFromDir(n)]))) : await loadFromMongo();
const cookie = await login();
let failures = 0;

for (const name of ORDER) {
  const docs = data[name];
  if (!docs) {
    console.log(`${name}: no export found, skipped`);
    continue;
  }
  const totals = { inserted: 0, already_present: 0, error_count: 0 };
  for (let i = 0; i < docs.length; i += CHUNK) {
    const r = await fetch(`${site}/api/admin/import/${name}`, { method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify({ docs: docs.slice(i, i + CHUNK) }) });
    if (!r.ok) throw new Error(`${name}: import request failed (${r.status}): ${await r.text()}`);
    const res = await r.json();
    totals.inserted += res.inserted;
    totals.already_present += res.already_present;
    totals.error_count += res.error_count;
    for (const e of res.errors ?? []) console.warn(`  ${name} ${e.id ?? "?"}: ${e.error}`);
  }
  failures += totals.error_count;
  console.log(`${name}: ${docs.length} read, ${totals.inserted} imported, ${totals.already_present} already there, ${totals.error_count} failed`);
}

console.log(failures ? `Done with ${failures} failed documents (see warnings above).` : "Done. Everything imported.");
console.log("Members need to sign in again on the new site; old login sessions are not carried over.");
