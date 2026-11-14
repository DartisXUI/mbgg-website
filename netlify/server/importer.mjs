// Imports documents exported from the original MongoDB database into Netlify Database.
// Re-runnable: rows that already exist (same primary key or unique key) are skipped.
import { q } from "./lib.mjs";

// Column types per table: t = text, i = integer, b = boolean, d = timestamptz, j = jsonb, a = text[]
const TABLES = {
  users: { pk: "user_id", cols: { user_id: "t", email: "t", name: "t", picture: "t", role: "t", player_tag: "t", bio: "t",
    password_hash: "t", subscription_expires_at: "d", subscription_started_at: "d", family: "j", guild_ids: "a", created_at: "d" } },
  payments: { pk: "checkout_id", cols: { checkout_id: "t", user_id: "t", product: "t", label: "t", amount_cents: "i",
    currency: "t", status: "t", method: "t", recorded_by: "t", meta: "j", result: "j", fulfilled: "b", square_order_id: "t",
    square_link_id: "t", square_payment_id: "t", checkout_url: "t", created_at: "d", paid_at: "d" } },
  checkins: { pk: "id", cols: { id: "t", user_id: "t", date: "t", session: "t", via: "t", family: "j", guild_id: "t",
    guild_name: "t", created_at: "d" } },
  game_logs: { pk: "id", cols: { id: "t", user_id: "t", title: "t", title_key: "t", genre: "t", player_count: "i",
    player_id: "t", playtime_min: "i", score: "i", placement: "i", played_at: "t", at_meetup: "b", created_at: "d" } },
  token_uses: { pk: "id", cols: { id: "t", user_id: "t", user_name: "t", month: "t", game: "t", note: "t", acknowledged: "b",
    acknowledged_by: "t", acknowledged_at: "d", created_at: "d" } },
  raffle_entries: { pk: "id", cols: { id: "t", user_id: "t", year: "i", number: "i", source: "t", ref: "t", created_at: "d" } },
  collections: { pk: "id", cols: { id: "t", user_id: "t", category: "t", title: "t", platform: "t", created_at: "d" } },
  guilds: { pk: "id", cols: { id: "t", name: "t", tag: "t", created_at: "d" } },
  quarter_awards: { pk: "id", cols: { id: "t", year: "i", quarter: "i", label: "t", end: "t", winner_user_id: "t",
    winner_name: "t", total_score: "i", created_at: "d" } },
  raffle_bonuses: { pk: "id", cols: { id: "t", user_id: "t", year: "i", period: "i", label: "t", entries: "i",
    raffle_year: "i", created_at: "d" } },
  prizes: { pk: "id", cols: { id: "t", user_id: "t", user_name: "t", prize: "t", event: "t", won_at: "t", collect_by: "t",
    collected: "b", recorded_by: "t", collected_at: "d", handed_over_by: "t", created_at: "d" } },
};

export const IMPORTABLE = Object.keys(TABLES);

// Unwrap MongoDB Extended JSON values such as {"$date": ...} or {"$numberInt": "3"}.
const plain = (v) => {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    if ("$date" in v) return typeof v.$date === "object" ? new Date(Number(v.$date.$numberLong)).toISOString() : v.$date;
    for (const k of ["$numberInt", "$numberLong", "$numberDouble", "$numberDecimal"]) if (k in v) return Number(v[k]);
    if ("$oid" in v) return v.$oid;
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]));
  }
  if (Array.isArray(v)) return v.map(plain);
  return v;
};

const convert = (type, v) => {
  switch (type) {
    case "d": {
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) throw new Error(`bad date ${v}`);
      return d;
    }
    case "i": return Math.round(Number(v));
    case "b": return Boolean(v);
    case "j": return JSON.stringify(v);
    case "a": return Array.isArray(v) ? v.map(String) : [];
    default: return typeof v === "string" ? v : String(v);
  }
};

const cast = { j: "::jsonb", a: "::text[]", d: "::timestamptz", i: "::int", b: "::boolean", t: "" };

export async function importCollection(name, docs) {
  const table = TABLES[name];
  if (!table) return { collection: name, skipped: true, reason: "not imported (sessions and login attempts are not migrated)" };
  let inserted = 0;
  let existing = 0;
  const errors = [];
  for (const raw of docs) {
    const doc = plain(raw);
    delete doc._id;
    try {
      if (name === "users") {
        doc.email = String(doc.email ?? "").trim().toLowerCase();
        doc.name ||= doc.email.split("@")[0] || "Member";
        // An account created on the new site with the same email (e.g. the seeded admin) is merged into the
        // imported one: its sessions follow, then the duplicate row is removed.
        const dup = await q("SELECT user_id FROM users WHERE email = $1 AND user_id <> $2", [doc.email, doc.user_id]);
        for (const { user_id } of dup) {
          if (await q("SELECT 1 FROM users WHERE user_id = $1", [doc.user_id]).then((r) => r.length)) break;
          await q("UPDATE user_sessions SET user_id = $2 WHERE user_id = $1", [user_id, doc.user_id]);
          await q("DELETE FROM users WHERE user_id = $1", [user_id]);
        }
      }
      if (name === "checkins") doc.session ??= "day";
      const cols = Object.keys(table.cols).filter((k) => doc[k] !== undefined && doc[k] !== null);
      if (!cols.includes(table.pk)) throw new Error(`missing ${table.pk}`);
      const values = cols.map((k) => convert(table.cols[k], doc[k]));
      const sqlText = `INSERT INTO ${name} (${cols.map((k) => `"${k}"`).join(", ")})
        VALUES (${cols.map((k, i) => `$${i + 1}${cast[table.cols[k]]}`).join(", ")})
        ON CONFLICT DO NOTHING RETURNING 1`;
      const rows = await q(sqlText, values);
      if (rows.length) inserted += 1;
      else existing += 1;
    } catch (e) {
      errors.push({ id: raw?.[table.pk] ?? null, error: e.message });
    }
  }
  return { collection: name, received: docs.length, inserted, already_present: existing, errors: errors.slice(0, 50),
    error_count: errors.length };
}
