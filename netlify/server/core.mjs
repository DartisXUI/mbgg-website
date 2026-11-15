// Core MBGG domain logic shared by the routes: users, sessions, Square payments, raffle and prizes.
import { getCookie, setCookie } from "hono/cookie";
import bcrypt from "bcryptjs";
import {
  addDays, addMonths, currentSlot, dateStr, fail, hex, isDuplicate, json, localDate, localParts, now, one, q, uid,
} from "./lib.mjs";

export const SESSION_DAYS = 7;
export const ANNUAL_CENTS = 12000;
export const CHECKIN_CENTS = 500;
export const BONUS_ENTRIES = 3;
export const raffleCents = () => {
  const n = Number.parseInt(process.env.RAFFLE_ENTRY_CENTS ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
};
export const PRICES = { annual: ANNUAL_CENTS, checkin: CHECKIN_CENTS, donation_5: 500, donation_10: 1000,
  donation_20: 2000, donation_50: 5000 };
export const GENRES = ["Strategy", "Deck-Builder", "Engine Builder", "Worker Placement", "Area Control",
  "Route Building", "Push Your Luck", "Trick-Taking", "Deduction", "Social Deduction", "Party", "Cooperative", "Dice",
  "Puzzle", "Abstract", "Trading", "Racing", "Fighting", "Simulation", "Other"];
export const PERIOD_NAMES = ["Jan–Feb", "Mar–Apr", "May–Jun", "Jul–Aug", "Sep–Oct", "Nov–Dec"];

// ---------- Users ----------
export const isSubscriber = (u) => Boolean(u?.subscription_expires_at) && new Date(u.subscription_expires_at) > now();
export const freeEntry = (u) => isSubscriber(u) || ["host", "admin"].includes(u.role);

export const publicUser = (u) => ({
  user_id: u.user_id, name: u.name, picture: u.picture ?? null, role: u.role ?? "member",
  player_tag: u.player_tag ?? "", bio: u.bio ?? "", is_subscriber: isSubscriber(u),
});

export const meView = (u) => ({
  ...publicUser(u), email: u.email, subscription_expires_at: u.subscription_expires_at ?? null,
  subscription_started_at: u.subscription_started_at ?? null, has_password: Boolean(u.password_hash),
  family: u.family ?? [],
});

export const getUserById = (id) => one("SELECT * FROM users WHERE user_id = $1", [id]);

export const insertUser = async ({ email, name, role = "member", password_hash = null, picture = null }) => one(
  `INSERT INTO users (user_id, email, name, picture, role, password_hash, created_at)
   VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
  [`user_${hex(6)}`, email, name, picture, role, password_hash, now()],
);

export const hashPw = (pw) => bcrypt.hash(pw, 12);
export const checkPw = (pw, h) => bcrypt.compare(pw, h).catch(() => false);

export const cleanEmail = (e) => {
  const v = String(e ?? "").trim().toLowerCase();
  if (!v.includes("@") || !v.split("@").at(-1).includes(".")) fail(400, "Enter a valid email");
  return v;
};

export const eligibleFamily = (u, ids) => {
  const fam = new Map((u.family ?? []).map((f) => [f.id, f]));
  const year = localParts().year;
  return [...new Set(ids)].map((i) => {
    const f = fam.get(i);
    if (!f) fail(400, "Unknown family member");
    const kind = f.kind ?? "child";
    if (kind === "child" && year - f.birth_year > 14) fail(400, `${f.name} is 15 or older and needs their own account`);
    return { id: f.id, name: f.name, kind };
  });
};

export const paidEarlier = async (userId, date) =>
  Boolean(await one("SELECT 1 FROM checkins WHERE user_id = $1 AND date = $2 AND via = 'paid' LIMIT 1", [userId, date]));

// ---------- Admin seed (runs once per server process) ----------
let seeding;
export const ensureAdmin = () => {
  seeding ??= seedAdmin().catch((e) => {
    console.error("seed admin failed", e);
    seeding = undefined;
  });
  return seeding;
};

// ADMIN_EMAIL may hold one address or a comma-separated list.
export const adminEmails = () =>
  (process.env.ADMIN_EMAIL ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);

export async function seedAdmin() {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) return;
  // An older build treated a comma-separated ADMIN_EMAIL as one address and created an account for the
  // whole string. No real email contains a comma, so remove that leftover account.
  const raw = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  if (raw?.includes(",")) {
    const junk = await one("SELECT user_id FROM users WHERE email = $1", [raw]);
    if (junk) {
      await q("DELETE FROM user_sessions WHERE user_id = $1", [junk.user_id]);
      await q("DELETE FROM users WHERE user_id = $1", [junk.user_id]);
    }
  }
  for (const email of adminEmails()) {
    const u = await one("SELECT * FROM users WHERE email = $1", [email]);
    if (!u) {
      await insertUser({ email, name: process.env.ADMIN_NAME || "Admin", role: "admin", password_hash: await hashPw(pw) })
        .catch((e) => { if (!isDuplicate(e)) throw e; });
      continue;
    }
    const hash = u.password_hash && (await checkPw(pw, u.password_hash)) ? u.password_hash : await hashPw(pw);
    await q("UPDATE users SET role = 'admin', password_hash = $2 WHERE user_id = $1", [u.user_id, hash]);
  }
}

// ---------- Sessions ----------
export async function createSession(c, userId) {
  const token = hex(32);
  await q("INSERT INTO user_sessions (session_token, user_id, expires_at, created_at) VALUES ($1, $2, $3, $4)",
    [token, userId, new Date(Date.now() + SESSION_DAYS * 86400e3), now()]);
  setCookie(c, "session_token", token, { httpOnly: true, secure: true, sameSite: "Lax", path: "/",
    maxAge: SESSION_DAYS * 86400 });
}

export const readToken = (c) => {
  const cookie = getCookie(c, "session_token");
  if (cookie) return cookie;
  const auth = c.req.header("authorization") ?? "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
};

export async function currentUser(c) {
  const token = readToken(c);
  if (!token) fail(401, "Not authenticated");
  const s = await one("SELECT * FROM user_sessions WHERE session_token = $1", [token]);
  if (!s || new Date(s.expires_at) < now()) fail(401, "Session expired");
  const u = await getUserById(s.user_id);
  if (!u) fail(401, "User not found");
  return u;
}

export async function requireStaff(c) {
  const u = await currentUser(c);
  if (!["host", "admin"].includes(u.role)) fail(403, "Hosts only");
  return u;
}

export async function requireAdmin(c) {
  const u = await currentUser(c);
  if (u.role !== "admin") fail(403, "Admin only");
  return u;
}

// ---------- Square payments ----------
export function squareCfg() {
  const token = process.env.SQUARE_ACCESS_TOKEN ?? "";
  const loc = process.env.SQUARE_LOCATION_ID ?? "";
  if (!token || !loc) fail(503, "Online payments aren't switched on yet. Please pay at the door for now.");
  const base = (process.env.SQUARE_ENV ?? "").toLowerCase() === "production"
    ? "https://connect.squareup.com" : "https://connect.squareupsandbox.com";
  return { base, token, loc };
}

export const sqHeaders = (token) => ({ Authorization: `Bearer ${token}`, "Square-Version": "2025-10-16",
  "Content-Type": "application/json" });

const timeoutFetch = (url, opts = {}, ms = 20000) => fetch(url, { ...opts, signal: AbortSignal.timeout(ms) });
export { timeoutFetch as fetchWithTimeout };

export async function assignRaffleNumbers(userId, year, qty, source, ref) {
  const numbers = [];
  while (numbers.length < qty) {
    const n = 1 + Math.floor(Math.random() * 9999);
    try {
      await q(`INSERT INTO raffle_entries (id, user_id, year, number, source, ref, created_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7)`, [uid(), userId, year, n, source, ref, now()]);
      numbers.push(n);
    } catch (e) {
      if (!isDuplicate(e)) throw e;
    }
  }
  return numbers;
}

export async function fulfil(p) {
  const result = {};
  if (p.product === "annual") {
    const u = await getUserById(p.user_id);
    const sub = isSubscriber(u);
    const start = sub ? new Date(u.subscription_expires_at) : now();
    const expires = new Date(start.getTime() + 365 * 86400e3);
    if (sub) await q("UPDATE users SET subscription_expires_at = $2 WHERE user_id = $1", [p.user_id, expires]);
    else await q("UPDATE users SET subscription_expires_at = $2, subscription_started_at = $3 WHERE user_id = $1",
      [p.user_id, expires, now()]);
  } else if (p.product === "checkin") {
    await q(`INSERT INTO checkins (id, user_id, date, session, via, family, created_at)
             VALUES ($1, $2, $3, $4, 'paid', $5::jsonb, $6) ON CONFLICT DO NOTHING`,
      [uid(), p.user_id, p.meta.date, p.meta.session ?? "day", json(p.meta.family ?? []), now()]);
  } else if (p.product === "raffle") {
    result.raffle_numbers = await assignRaffleNumbers(p.user_id, p.meta.year, p.meta.quantity, "purchase", p.checkout_id);
  }
  await q("UPDATE payments SET fulfilled = true, result = $2::jsonb WHERE checkout_id = $1", [p.checkout_id, json(result)]);
  return { ...p, fulfilled: true, result };
}

export async function verifyPayment(p) {
  if (p.status !== "PENDING") return p;
  const { base, token } = squareCfg();
  const r = await timeoutFetch(`${base}/v2/orders/${encodeURIComponent(p.square_order_id)}`, { headers: sqHeaders(token) });
  if (!r.ok) return p;
  const order = (await r.json()).order ?? {};
  for (const t of order.tenders ?? []) {
    const pid = t.payment_id ?? t.id;
    const pr = await timeoutFetch(`${base}/v2/payments/${encodeURIComponent(pid)}`, { headers: sqHeaders(token) });
    const pay = pr.ok ? (await pr.json()).payment ?? {} : {};
    const money = pay.amount_money ?? {};
    if (pay.status === "COMPLETED" && money.amount === p.amount_cents && money.currency === "AUD") {
      const claimed = await one(
        `UPDATE payments SET status = 'COMPLETED', square_payment_id = $2, paid_at = $3
         WHERE checkout_id = $1 AND status = 'PENDING' RETURNING *`, [p.checkout_id, pid, now()]);
      if (claimed) return fulfil(claimed);
    }
  }
  if (order.state === "CANCELED") {
    await q("UPDATE payments SET status = 'CANCELED' WHERE checkout_id = $1", [p.checkout_id]);
    return { ...p, status: "CANCELED" };
  }
  return p;
}

export const paymentView = (p) => Object.fromEntries(
  ["checkout_id", "product", "label", "amount_cents", "currency", "status", "created_at", "paid_at", "result"]
    .map((k) => [k, p[k] ?? null]));

export async function reconcilePending(userId) {
  if (!process.env.SQUARE_ACCESS_TOKEN) return;
  const pending = await q(
    `SELECT * FROM payments WHERE user_id = $1 AND status = 'PENDING' AND created_at >= $2
     ORDER BY created_at DESC LIMIT 5`, [userId, new Date(Date.now() - 2 * 86400e3)]);
  for (const p of pending) {
    try {
      await verifyPayment(p);
    } catch (e) {
      console.error("reconcile failed", p.checkout_id, e?.message);
    }
  }
}

// ---------- Raffle bonus (log every attended session in a 2-month period) ----------
export const periodBounds = (year, idx) => {
  const start = dateStr(year, idx * 2 + 1);
  return [start, addDays(addMonths(start, 2), -1)];
};

export async function periodProgress(userId, year, idx) {
  const [s, e] = periodBounds(year, idx);
  const dates = (await q("SELECT DISTINCT date FROM checkins WHERE user_id = $1 AND date >= $2 AND date <= $3 ORDER BY date",
    [userId, s, e])).map((r) => r.date);
  const logged = new Set((await q(`SELECT DISTINCT played_at FROM game_logs
    WHERE user_id = $1 AND played_at >= $2 AND played_at <= $3 AND at_meetup`, [userId, s, e])).map((r) => r.played_at));
  const missing = dates.filter((d) => !logged.has(d));
  return { year, period: idx, label: `${PERIOD_NAMES[idx]} ${year}`, start: s, end: e, sessions: dates.length,
    logged_sessions: dates.length - missing.length, missing_dates: missing,
    qualifies: dates.length > 0 && missing.length === 0, raffle_year: idx < 5 ? year : year + 1 };
}

export async function awardBonuses(userId) {
  const today = localDate();
  const year = Number(today.slice(0, 4));
  const done = new Set((await q("SELECT year, period FROM raffle_bonuses WHERE user_id = $1", [userId]))
    .map((r) => `${r.year}-${r.period}`));
  for (const y of [year - 1, year]) {
    for (let idx = 0; idx < 6; idx++) {
      if (periodBounds(y, idx)[1] >= today || done.has(`${y}-${idx}`)) continue;
      const prog = await periodProgress(userId, y, idx);
      if (!prog.qualifies) continue;
      const raffleYear = Math.max(prog.raffle_year, year);
      try {
        await q(`INSERT INTO raffle_bonuses (id, user_id, year, period, label, entries, raffle_year, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [uid(), userId, y, idx, prog.label, BONUS_ENTRIES, raffleYear, now()]);
      } catch (e) {
        if (isDuplicate(e)) continue;
        throw e;
      }
      await assignRaffleNumbers(userId, raffleYear, BONUS_ENTRIES, "bonus", `${y}-${idx}`);
    }
  }
}

export async function unloggedCheckins(userId) {
  const today = localDate();
  const dates = (await q("SELECT DISTINCT date FROM checkins WHERE user_id = $1 AND date >= $2 AND date < $3",
    [userId, addDays(today, -14), currentSlot()[0]])).map((r) => r.date);
  if (!dates.length) return [];
  const logged = new Set((await q(
    "SELECT DISTINCT played_at FROM game_logs WHERE user_id = $1 AND played_at = ANY($2::text[]) AND at_meetup",
    [userId, dates])).map((r) => r.played_at));
  return dates.filter((d) => !logged.has(d)).sort().reverse();
}

// ---------- Quarterly subscriber top-score prize ----------
export const quarterEnd = (year, qtr) => addDays(addMonths(dateStr(year, qtr * 3), 1), -1);

const subscribedOn = (u, d) => Boolean(u.subscription_started_at && u.subscription_expires_at)
  && localDate(new Date(u.subscription_started_at)) <= d && d <= localDate(new Date(u.subscription_expires_at));

export async function ytdStandings(year, end) {
  const rows = await q(`SELECT g.user_id, sum(g.score)::float8 AS total_score, count(*)::int AS games,
      u.name, u.picture, u.subscription_started_at, u.subscription_expires_at
    FROM game_logs g JOIN users u ON u.user_id = g.user_id
    WHERE g.played_at >= $1 AND g.played_at <= $2
    GROUP BY g.user_id, u.name, u.picture, u.subscription_started_at, u.subscription_expires_at`,
  [`${year}-01-01`, end]);
  return rows.filter((r) => subscribedOn(r, end))
    .map((r) => ({ user_id: r.user_id, name: r.name, picture: r.picture, total_score: r.total_score, games: r.games }))
    .sort((a, b) => b.total_score - a.total_score || a.games - b.games);
}

export async function awardQuarterPrizes() {
  const today = localDate();
  const year = Number(today.slice(0, 4));
  for (const y of [year - 1, year]) {
    for (let qtr = 1; qtr <= 4; qtr++) {
      const end = quarterEnd(y, qtr);
      if (addDays(end, 7) >= today) continue;
      if (await one("SELECT 1 FROM quarter_awards WHERE year = $1 AND quarter = $2", [y, qtr])) continue;
      const [w] = await ytdStandings(y, end);
      if (!w) continue;
      try {
        await q(`INSERT INTO quarter_awards (id, year, quarter, label, "end", winner_user_id, winner_name, total_score, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [uid(), y, qtr, `Q${qtr} ${y}`, end, w.user_id, w.name, Math.round(w.total_score), now()]);
      } catch (e) {
        if (isDuplicate(e)) continue;
        throw e;
      }
      const won = addDays(end, 1);
      await q(`INSERT INTO prizes (id, user_id, user_name, prize, event, won_at, collect_by, collected, recorded_by, created_at)
               VALUES ($1, $2, $3, $4, 'Quarterly leaderboard', $5, $6, false, 'Leaderboard (automatic)', $7)`,
        [uid(), w.user_id, w.name, `Top subscriber score prize · Q${qtr} ${y}`, won, addMonths(won, 3), now()]);
    }
  }
}
