// Murray Bridge Games Group API — Netlify Server (Hono). Ported from the original FastAPI backend.
// Every route lives under /api; other paths fall back to the React app's index.html.
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import {
  addDays, addMonths, body, currentSlot, dateStr, fail, hex, idList, int, isDateStr, isDuplicate, json, localDate,
  localMonth, localParts, now, one, oneOf, q, SESSION_LABELS, str, uid,
} from "./lib.mjs";
import {
  ANNUAL_CENTS, BONUS_ENTRIES, CHECKIN_CENTS, GENRES, PRICES, awardBonuses, awardQuarterPrizes, checkPw, cleanEmail,
  adminEmails, createSession, currentUser, eligibleFamily, ensureAdmin, fetchWithTimeout, freeEntry, fulfil, getUserById, hashPw,
  insertUser, isSubscriber, meView, paidEarlier, cashPass, removeCheckin, paymentView, periodProgress, publicUser, quarterEnd, raffleCents,
  readToken, reconcilePending, requireAdmin, requireStaff, seedAdmin, sqHeaders, squareCfg, unloggedCheckins,
  verifyPayment, ytdStandings,
} from "./core.mjs";
import { importCollection } from "./importer.mjs";

const app = new Hono();

app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ detail: err.message }, err.status);
  console.error(err);
  return c.json({ detail: "Something went wrong" }, 500);
});

app.use("/api/*", async (c, next) => {
  await ensureAdmin();
  await next();
});

const publicOrigin = (c) => {
  const url = new URL(c.req.url);
  const host = c.req.header("x-forwarded-host") ?? c.req.header("host") ?? url.host;
  const proto = c.req.header("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return `${proto.split(",")[0].trim()}://${host.split(",")[0].trim()}`;
};

// ---------- Auth ----------
app.post("/api/auth/register", async (c) => {
  const b = await body(c);
  const name = str(b, "name", { min: 1, max: 60 }).trim();
  const email = cleanEmail(str(b, "email", { min: 3, max: 120 }));
  const password = str(b, "password", { min: 8, max: 128 });
  if (!name) fail(400, "Enter a name");
  if (await one("SELECT 1 FROM users WHERE email = $1", [email])) fail(409, "An account with this email already exists");
  let u;
  try {
    u = await insertUser({ email, name, password_hash: await hashPw(password) });
  } catch (e) {
    if (isDuplicate(e)) fail(409, "An account with this email already exists");
    throw e;
  }
  await createSession(c, u.user_id);
  return c.json(meView(u));
});

app.post("/api/auth/login", async (c) => {
  const b = await body(c);
  const email = cleanEmail(str(b, "email"));
  const password = str(b, "password");
  const ip = (c.req.header("x-nf-client-connection-ip") ?? c.req.header("x-forwarded-for") ?? "").split(",")[0].trim();
  const since = new Date(Date.now() - 15 * 60e3);
  const { n } = await one("SELECT count(*)::int AS n FROM login_attempts WHERE email = $1 AND ip = $2 AND at >= $3",
    [email, ip, since]);
  if (n >= 5) fail(429, "Too many attempts. Try again in 15 minutes");
  const u = await one("SELECT * FROM users WHERE email = $1", [email]);
  if (!u || !u.password_hash || !(await checkPw(password, u.password_hash))) {
    await q("INSERT INTO login_attempts (email, ip, at) VALUES ($1, $2, $3)", [email, ip, now()]);
    fail(401, "Wrong email or password");
  }
  await q("DELETE FROM login_attempts WHERE email = $1", [email]);
  await createSession(c, u.user_id);
  return c.json(meView(u));
});

// Google sign-in: standard OAuth 2.0 authorization-code flow with a state cookie.
const GOOGLE_STATE = "g_oauth_state";
const googleRedirectUri = (c) => `${publicOrigin(c)}/api/auth/google/callback`;

app.get("/api/auth/google/start", (c) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId || !process.env.GOOGLE_CLIENT_SECRET) return c.redirect("/login?error=google");
  const state = hex(16);
  setCookie(c, GOOGLE_STATE, state, { httpOnly: true, secure: true, sameSite: "Lax", path: "/api/auth/google", maxAge: 600 });
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: googleRedirectUri(c), response_type: "code",
    scope: "openid email profile", state, prompt: "select_account" });
  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

app.get("/api/auth/google/callback", async (c) => {
  const expected = getCookie(c, GOOGLE_STATE);
  deleteCookie(c, GOOGLE_STATE, { path: "/api/auth/google", secure: true });
  const { code, state } = c.req.query();
  if (!code || !state || !expected || state !== expected) return c.redirect("/login?error=google");
  try {
    const tr = await fetchWithTimeout("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: googleRedirectUri(c), grant_type: "authorization_code" }),
    }, 15000);
    if (!tr.ok) throw new Error(`token exchange ${tr.status}`);
    const { access_token } = await tr.json();
    const ur = await fetchWithTimeout("https://openidconnect.googleapis.com/v1/userinfo",
      { headers: { Authorization: `Bearer ${access_token}` } }, 15000);
    if (!ur.ok) throw new Error(`userinfo ${ur.status}`);
    const d = await ur.json();
    if (!d.email || d.email_verified === false) throw new Error("unverified email");
    const email = d.email.trim().toLowerCase();
    let u = await one("SELECT * FROM users WHERE email = $1", [email]);
    if (u) await q("UPDATE users SET picture = $2 WHERE user_id = $1", [u.user_id, d.picture ?? null]);
    else u = await insertUser({ email, name: d.name || email.split("@")[0], picture: d.picture ?? null });
    if (adminEmails().includes(email) && u.role !== "admin") {
      await q("UPDATE users SET role = 'admin' WHERE user_id = $1", [u.user_id]);
    }
    await createSession(c, u.user_id);
    return c.redirect("/account");
  } catch (e) {
    console.error("Google sign-in failed:", e?.message);
    return c.redirect("/login?error=google");
  }
});

app.get("/api/auth/me", async (c) => c.json(meView(await currentUser(c))));

app.post("/api/auth/logout", async (c) => {
  const token = readToken(c);
  if (token) await q("DELETE FROM user_sessions WHERE session_token = $1", [token]);
  deleteCookie(c, "session_token", { path: "/", secure: true });
  return c.json({ ok: true });
});

app.patch("/api/me/profile", async (c) => {
  const user = await currentUser(c);
  const b = await body(c);
  const upd = {};
  const name = str(b, "name", { min: 1, max: 60, optional: true });
  const tag = str(b, "player_tag", { max: 40, optional: true });
  const bio = str(b, "bio", { max: 300, optional: true });
  if (name !== undefined) upd.name = name.trim();
  if (tag !== undefined) upd.player_tag = tag.trim();
  if (bio !== undefined) upd.bio = bio.trim();
  if (Object.keys(upd).length) {
    await q(`UPDATE users SET name = COALESCE($2, name), player_tag = COALESCE($3, player_tag), bio = COALESCE($4, bio)
             WHERE user_id = $1`, [user.user_id, upd.name ?? null, upd.player_tag ?? null, upd.bio ?? null]);
  }
  return c.json(meView({ ...user, ...upd }));
});

// ---------- Square payments ----------
const PRODUCTS = ["annual", "checkin", "raffle", "donation_5", "donation_10", "donation_20", "donation_50", "donation_custom"];

function priceFor(b) {
  if (b.product === "donation_custom") {
    const raw = b.custom_amount;
    const amt = typeof raw === "number" ? raw : Number.parseFloat(raw);
    if (raw === undefined || raw === null || !Number.isFinite(amt) || !/^\d+(\.\d{1,2})?$/.test(String(raw).trim())) {
      if (raw === undefined || raw === null) fail(400, "Custom donation minimum is $1.00");
      fail(422, "Enter an amount with up to 2 decimal places");
    }
    if (amt < 1) fail(400, "Custom donation minimum is $1.00");
    if (amt > 5000) fail(400, "Custom donation maximum is $5,000");
    return [Math.round(amt * 100), "Donation to Murray Bridge Games Group"];
  }
  if (b.product === "raffle") {
    const cents = raffleCents();
    if (!cents) fail(503, "Raffle entries aren't on sale yet");
    return [cents * b.quantity, `Lucky Number Raffle Entry x${b.quantity}`];
  }
  const names = { annual: "Annual Membership (12 months)", checkin: "Session Admission" };
  return [PRICES[b.product], names[b.product] ?? "Donation to Murray Bridge Games Group"];
}

app.post("/api/payments/checkout", async (c) => {
  const user = await currentUser(c);
  const raw = await body(c);
  const b = { product: oneOf(raw, "product", PRODUCTS), custom_amount: raw.custom_amount,
    quantity: int(raw, "quantity", { min: 1, max: 20, def: 1 }), family_ids: idList(raw, "family_ids") };
  const meta = {};
  if (b.product === "checkin") {
    if (freeEntry(user)) fail(400, "You check in free. Use the free check-in button");
    [meta.date, meta.session] = currentSlot();
    meta.family = eligibleFamily(user, b.family_ids);
    if (await paidEarlier(user.user_id, meta.date))
      fail(400, "You already paid today, so this session is free. Use the free check-in button");
    if (await cashPass(user.user_id, meta.date, meta.session))
      fail(400, "Your $5 for this session is already paid. Use the check-in button");
    if (await one("SELECT 1 FROM checkins WHERE user_id = $1 AND date = $2 AND session = $3",
      [user.user_id, meta.date, meta.session])) fail(400, "You're already checked in for this session");
  }
  if (b.product === "raffle") {
    meta.quantity = b.quantity;
    meta.year = localParts().year;
  }
  const [amount, name] = priceFor(b);
  const { base, token, loc } = squareCfg();
  if (b.product !== "raffle") {
    const pending = await q(`SELECT * FROM payments WHERE user_id = $1 AND product = $2 AND amount_cents = $3
      AND status = 'PENDING' AND checkout_url IS NOT NULL AND created_at >= $4 ORDER BY created_at DESC`,
    [user.user_id, b.product, amount, new Date(Date.now() - 20 * 60e3)]);
    const same = (x, y) => JSON.stringify(x ?? null) === JSON.stringify(y ?? null);
    const recent = pending.find((p) => same(p.meta?.date, meta.date) && same(p.meta?.session, meta.session)
      && same(p.meta?.family, meta.family));
    if (recent) return c.json({ checkout_id: recent.checkout_id, checkout_url: recent.checkout_url });
  }
  let origin = c.req.header("origin") || (c.req.header("referer") ?? "").replace(/\/$/, "");
  if (!origin.startsWith("http")) fail(400, "Missing origin");
  origin = origin.split("/").slice(0, 3).join("/");
  const checkoutId = uid();
  const payload = { idempotency_key: checkoutId, description: checkoutId,
    quick_pay: { name, price_money: { amount, currency: "AUD" }, location_id: loc },
    payment_note: `mbgg:${checkoutId}:${user.email}`,
    checkout_options: { redirect_url: `${origin}/checkout/complete?checkout_id=${checkoutId}` } };
  const r = await fetchWithTimeout(`${base}/v2/online-checkout/payment-links`,
    { method: "POST", headers: sqHeaders(token), body: JSON.stringify(payload) });
  if (!r.ok) {
    console.error("Square create link failed", r.status, (await r.text()).slice(0, 500));
    fail(400, "Square couldn't start the checkout. Please try again");
  }
  const link = (await r.json()).payment_link;
  await q(`INSERT INTO payments (checkout_id, user_id, product, label, amount_cents, currency, status, meta,
      square_order_id, square_link_id, checkout_url, created_at)
    VALUES ($1, $2, $3, $4, $5, 'AUD', 'PENDING', $6::jsonb, $7, $8, $9, $10)`,
  [checkoutId, user.user_id, b.product, name, amount, json(meta), link.order_id, link.id, link.url, now()]);
  return c.json({ checkout_id: checkoutId, checkout_url: link.url });
});

app.get("/api/payments/:checkout_id", async (c) => {
  const user = await currentUser(c);
  const p = await one("SELECT * FROM payments WHERE checkout_id = $1 AND user_id = $2", [c.req.param("checkout_id"), user.user_id]);
  if (!p) fail(404, "Payment not found");
  return c.json(paymentView(await verifyPayment(p)));
});

// ---------- Dashboard / check-in ----------
app.get("/api/me/dashboard", async (c) => {
  let user = await currentUser(c);
  await reconcilePending(user.user_id);
  await awardBonuses(user.user_id);
  user = await getUserById(user.user_id);
  const id = user.user_id;
  const [slotDate, slot] = currentSlot();
  const month = localMonth();
  const lp = localParts();
  const ld = dateStr(lp.year, lp.month, lp.day);
  const periodStart = isSubscriber(user) && user.subscription_started_at
    ? new Date(user.subscription_started_at) : new Date(Date.now() - 365 * 86400e3);
  const startDate = localDate(periodStart);
  const checkins = await q("SELECT * FROM checkins WHERE user_id = $1 ORDER BY date DESC, created_at DESC LIMIT 400", [id]);
  const inPeriod = checkins.filter((ch) => ch.date >= startDate && !["guild", "casual"].includes(ch.via));
  const [token, raffle, payments, bonusNow, bonuses, prizes, guildRows, unlogged, secondFree, paidDay, paidCash] = await Promise.all([
    one("SELECT * FROM token_uses WHERE user_id = $1 AND month = $2", [id, month]),
    q("SELECT number, source FROM raffle_entries WHERE user_id = $1 AND year = $2 ORDER BY number", [id, lp.year]),
    q("SELECT * FROM payments WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10", [id]),
    periodProgress(id, lp.year, Math.floor((lp.month - 1) / 2)),
    q("SELECT * FROM raffle_bonuses WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50", [id]),
    q("SELECT * FROM prizes WHERE user_id = $1 ORDER BY won_at DESC LIMIT 50", [id]),
    q("SELECT * FROM guilds WHERE id = ANY($1::text[]) ORDER BY name", [user.guild_ids ?? []]),
    unloggedCheckins(id),
    freeEntry(user) ? false : paidEarlier(id, slotDate),
    isPaidMeetupDay(slotDate),
    freeEntry(user) ? false : cashPass(id, slotDate, slot),
  ]);
  const todayCheckin = checkins.find((ch) => ch.date === slotDate && (ch.session ?? "day") === slot) ?? null;
  return c.json({
    user: meView(user), today: slotDate, checked_in_today: Boolean(todayCheckin),
    session: { key: slot, label: SESSION_LABELS[slot] }, second_session_free: secondFree, cash_entry: paidCash || false, paid_meetup_day: paidDay,
    today_checkin: todayCheckin, free_entry: freeEntry(user), unlogged_dates: unlogged,
    attendance: { sessions: inPeriod.length, since: startDate,
      door_value_cents: new Set(inPeriod.map((ch) => ch.date)).size * CHECKIN_CENTS, membership_cents: ANNUAL_CENTS },
    recent_checkins: checkins.slice(0, 8), token, month,
    raffle_entries: raffle.map((r) => ({ number: r.number, source: r.source ?? "purchase" })),
    raffle_entry_cents: raffleCents(), bonus: { current: bonusNow, awarded: bonuses, entries: BONUS_ENTRIES },
    prizes, today_date: ld, guilds: guildRows,
    guild_checkins_today: checkins.filter((ch) => ch.date === slotDate && ch.via === "guild").map((ch) => ch.guild_id),
    guild_checkin_ids: Object.fromEntries(checkins.filter((ch) => ch.date === slotDate && ch.via === "guild")
      .map((ch) => [ch.guild_id, ch.id])),
    casual_checkin_today: checkins.find((ch) => ch.date === slotDate && ch.via === "casual") ?? null,
    payments: payments.map(paymentView),
  });
});

app.get("/api/me/reminders", async (c) => {
  const user = await currentUser(c);
  return c.json({ unlogged_dates: await unloggedCheckins(user.user_id) });
});

app.post("/api/me/family", async (c) => {
  const user = await currentUser(c);
  const b = await body(c);
  const name = str(b, "name", { min: 1, max: 60 });
  const kind = oneOf(b, "kind", ["child", "support"], "child");
  const birthYear = int(b, "birth_year", { optional: true });
  if (!name.trim()) fail(400, "Enter a name");
  const year = localParts().year;
  if (kind === "child" && (birthYear === undefined || !(year - birthYear >= 0 && year - birthYear <= 14)))
    fail(400, "Family members listed here must be under 15");
  if ((user.family ?? []).filter((f) => (f.kind ?? "child") === kind).length >= 10) fail(400, "Up to 10 people of each type");
  const f = { id: hex(6), name: name.trim(), kind, birth_year: kind === "child" ? birthYear : null };
  await q("UPDATE users SET family = family || $2::jsonb WHERE user_id = $1", [user.user_id, json([f])]);
  return c.json(f);
});

app.delete("/api/me/family/:fid", async (c) => {
  const user = await currentUser(c);
  const fid = c.req.param("fid");
  const r = await one(`UPDATE users SET family = COALESCE((SELECT jsonb_agg(f) FROM jsonb_array_elements(family) f
      WHERE f->>'id' <> $2), '[]'::jsonb)
    WHERE user_id = $1 AND EXISTS (SELECT 1 FROM jsonb_array_elements(family) f WHERE f->>'id' = $2) RETURNING user_id`,
  [user.user_id, fid]);
  if (!r) fail(404, "Family member not found");
  return c.json({ ok: true });
});

app.post("/api/checkin/family", async (c) => {
  const user = await currentUser(c);
  const fam = eligibleFamily(user, idList(await body(c), "family_ids"));
  if (!fam.length) fail(400, "Pick who is with you");
  const [d, s] = currentSlot();
  const row = await one("SELECT * FROM checkins WHERE user_id = $1 AND date = $2 AND session = $3", [user.user_id, d, s]);
  if (!row) fail(400, "Check yourself in first");
  const have = new Set((row.family ?? []).map((f) => f.id));
  const added = fam.filter((f) => !have.has(f.id));
  if (added.length) await q("UPDATE checkins SET family = family || $2::jsonb WHERE id = $1", [row.id, json(added)]);
  return c.json({ ok: true, added: added.length });
});

const isPaidMeetupDay = async (d) => Boolean(await one("SELECT 1 FROM paid_meetup_days WHERE date = $1", [d]));
const PAID_DAY_MSG = "Today is an official paid meetup, so free casual and guild check-ins are off. Use the session check-in instead";

async function insertCheckin(doc, dupMsg) {
  try {
    await q(`INSERT INTO checkins (id, user_id, date, session, via, family, guild_id, guild_name, created_at)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)`,
    [uid(), doc.user_id, doc.date, doc.session, doc.via, json(doc.family), doc.guild_id ?? null, doc.guild_name ?? null, now()]);
  } catch (e) {
    if (isDuplicate(e)) fail(400, dupMsg);
    throw e;
  }
}

app.post("/api/checkin", async (c) => {
  const user = await currentUser(c);
  const [d, s] = currentSlot();
  let via;
  let pass;
  if (freeEntry(user)) via = isSubscriber(user) ? "subscription" : "staff";
  else if ((pass = await cashPass(user.user_id, d, s))) via = pass === "cash" ? "cash" : "paid";
  else if (await paidEarlier(user.user_id, d)) via = "paid_earlier";
  else fail(402, "Admission is $5. Use check in & pay");
  const family = eligibleFamily(user, idList(await body(c), "family_ids"));
  await insertCheckin({ user_id: user.user_id, date: d, session: s, via, family }, "You're already checked in for this session");
  return c.json({ ok: true, date: d, session: s });
});

// Undo your own check-in for today (checked in by accident). A paid $5 stays on record for the session, so
// checking in again later doesn't charge twice.
app.delete("/api/checkin/:id", async (c) => {
  const user = await currentUser(c);
  const row = await one("SELECT * FROM checkins WHERE id = $1 AND user_id = $2", [c.req.param("id"), user.user_id]);
  if (!row) fail(404, "Check-in not found");
  if (row.date !== currentSlot()[0]) fail(400, "Only today's check-ins can be undone. Ask a host to fix older ones");
  return c.json({ ok: true, unmarked_logs: await removeCheckin(row) });
});

// ---------- Monthly game choice token ----------
app.post("/api/token/use", async (c) => {
  const user = await currentUser(c);
  const b = await body(c);
  const game = str(b, "game", { min: 1, max: 80 }).trim();
  const note = str(b, "note", { max: 200, def: "" }).trim();
  if (!isSubscriber(user)) fail(403, "The monthly game choice is for annual subscribers");
  try {
    const doc = await one(`INSERT INTO token_uses (id, user_id, user_name, month, game, note, acknowledged, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, false, $7) RETURNING *`, [uid(), user.user_id, user.name, localMonth(), game, note, now()]);
    return c.json(doc);
  } catch (e) {
    if (isDuplicate(e)) fail(400, "You've already used this month's game choice");
    throw e;
  }
});

// ---------- Game logs & leaderboards ----------
app.post("/api/logs", async (c) => {
  const user = await currentUser(c);
  const b = await body(c);
  const title = str(b, "title", { min: 1, max: 80 });
  const genre = str(b, "genre");
  const playerCount = int(b, "player_count", { min: 1, max: 30 });
  const playerId = str(b, "player_id", { min: 1, max: 40 });
  const playtime = int(b, "playtime_min", { min: 1, max: 1440 });
  // Score is optional: many games have no score, health or victory points. 0 is a valid score (e.g. health hit 0).
  const score = int(b, "score", { min: -100000, max: 10000000, optional: true }) ?? null;
  const placement = int(b, "placement", { min: 1, max: 30 });
  const atMeetup = b.at_meetup === true;
  if (!GENRES.includes(genre)) fail(400, "Pick a genre from the list");
  if (placement > playerCount)
    fail(400, `Placement (${placement}) can't be higher than the number of players (${playerCount}). Count everyone at the table, not teams`);
  const today = localDate();
  const played = (str(b, "played_at", { optional: true }) || currentSlot()[0]).slice(0, 10);
  if (!isDateStr(played)) fail(400, "Invalid date");
  if (played > today || played < addDays(today, -365)) fail(400, "Date must be within the last 365 days");
  if (atMeetup && !(await one("SELECT 1 FROM checkins WHERE user_id = $1 AND date = $2 LIMIT 1", [user.user_id, played])))
    fail(400, "You weren't checked in to a meetup that day. Untick 'Played at an IRL meetup'");
  const key = title.toLowerCase().split(/\s+/).filter(Boolean).join(" ");
  const existing = await one("SELECT title FROM game_logs WHERE title_key = $1 ORDER BY created_at LIMIT 1", [key]);
  const doc = await one(`INSERT INTO game_logs (id, user_id, title, title_key, genre, player_count, player_id, playtime_min,
      score, placement, played_at, at_meetup, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
  [uid(), user.user_id, existing ? existing.title : title.trim(), key, genre, playerCount, playerId, playtime, score,
    placement, played, atMeetup, now()]);
  return c.json(doc);
});

app.get("/api/me/checkin-dates", async (c) => {
  const user = await currentUser(c);
  const rows = await q("SELECT DISTINCT date FROM checkins WHERE user_id = $1 AND date >= $2 ORDER BY date",
    [user.user_id, addDays(localDate(), -366)]);
  return c.json(rows.map((r) => r.date));
});

app.get("/api/logs/me", async (c) => {
  const user = await currentUser(c);
  return c.json(await q("SELECT * FROM game_logs WHERE user_id = $1 ORDER BY played_at DESC, created_at DESC LIMIT 2000",
    [user.user_id]));
});

app.delete("/api/logs/:log_id", async (c) => {
  const user = await currentUser(c);
  const r = await one("DELETE FROM game_logs WHERE id = $1 AND user_id = $2 RETURNING id", [c.req.param("log_id"), user.user_id]);
  if (!r) fail(404, "Log not found");
  return c.json({ ok: true });
});

app.get("/api/meta/genres", (c) => c.json(GENRES));

const STATS = `COALESCE(sum(score), 0)::float8 AS total_score, count(*)::int AS games,
  (count(*) FILTER (WHERE placement = 1))::int AS wins, sum(playtime_min)::float8 AS playtime_min`;

app.get("/api/leaderboards", async (c) => {
  await currentUser(c);
  const game = c.req.query("game") || null;
  const cutoff = addDays(localDate(), -365);
  const titles = await q(`SELECT title_key AS key, (array_agg(title ORDER BY created_at))[1] AS title, count(*)::int AS plays
    FROM game_logs WHERE played_at >= $1 GROUP BY title_key ORDER BY plays DESC LIMIT 200`, [cutoff]);
  const rows = await q(`SELECT g.user_id, u.name, u.picture, ${STATS},
      (count(*) FILTER (WHERE placement <= 3))::int AS podiums, avg(placement)::float8 AS avg_placement,
      max(score) AS best_score
    FROM game_logs g LEFT JOIN users u ON u.user_id = g.user_id
    WHERE played_at >= $1 AND ($2::text IS NULL OR title_key = $2)
    GROUP BY g.user_id, u.name, u.picture`, [cutoff, game]);
  return c.json({ since: cutoff, games: titles, rows: rows.map((r) => ({
    user_id: r.user_id, name: r.name ?? "Player", picture: r.picture ?? null, total_score: r.total_score, games: r.games,
    wins: r.wins, podiums: r.podiums, avg_placement: Math.round(r.avg_placement * 100) / 100,
    win_rate: Math.round((1000 * r.wins) / r.games) / 10, playtime_min: r.playtime_min, best_score: r.best_score,
  })) });
});

// ---------- Guilds (membership mirrors the group's Discord; managed by hosts/admins) ----------
async function listGuilds() {
  const guilds = await q("SELECT * FROM guilds ORDER BY name LIMIT 500");
  const users = await q("SELECT user_id, name, picture, guild_ids FROM users WHERE cardinality(guild_ids) > 0");
  return guilds.map((g) => ({ ...g, members: users.filter((u) => u.guild_ids.includes(g.id))
    .map((u) => ({ user_id: u.user_id, name: u.name, picture: u.picture ?? null })) }));
}

app.get("/api/guilds", async (c) => c.json(await listGuilds()));

app.post("/api/admin/guilds", async (c) => {
  await requireStaff(c);
  const b = await body(c);
  const name = str(b, "name", { min: 1, max: 60 }).trim();
  const tag = str(b, "tag", { min: 1, max: 12 }).trim().toUpperCase();
  if (!name || !tag) fail(400, "Enter a guild name and ID");
  try {
    return c.json(await one("INSERT INTO guilds (id, name, tag, created_at) VALUES ($1, $2, $3, $4) RETURNING *",
      [hex(6), name, tag, now()]));
  } catch (e) {
    if (isDuplicate(e)) fail(409, "That guild ID is already used");
    throw e;
  }
});

app.delete("/api/admin/guilds/:gid", async (c) => {
  await requireAdmin(c);
  const gid = c.req.param("gid");
  if (!(await one("DELETE FROM guilds WHERE id = $1 RETURNING id", [gid]))) fail(404, "Guild not found");
  await q("UPDATE users SET guild_ids = array_remove(guild_ids, $1) WHERE $1 = ANY(guild_ids)", [gid]);
  return c.json({ ok: true });
});

app.post("/api/admin/guilds/:gid/members", async (c) => {
  await requireStaff(c);
  const gid = c.req.param("gid");
  const userId = str(await body(c), "user_id");
  if (!(await one("SELECT 1 FROM guilds WHERE id = $1", [gid]))) fail(404, "Guild not found");
  const r = await one(`UPDATE users SET guild_ids = CASE WHEN $1 = ANY(guild_ids) THEN guild_ids ELSE array_append(guild_ids, $1) END
    WHERE user_id = $2 RETURNING user_id`, [gid, userId]);
  if (!r) fail(404, "User not found");
  return c.json({ ok: true });
});

app.delete("/api/admin/guilds/:gid/members/:user_id", async (c) => {
  await requireStaff(c);
  const gid = c.req.param("gid");
  const r = await one("UPDATE users SET guild_ids = array_remove(guild_ids, $1) WHERE user_id = $2 AND $1 = ANY(guild_ids) RETURNING user_id",
    [gid, c.req.param("user_id")]);
  if (!r) fail(404, "Member not in this guild");
  return c.json({ ok: true });
});

app.post("/api/checkin/guild", async (c) => {
  const user = await currentUser(c);
  const b = await body(c);
  const gid = str(b, "guild_id");
  const g = await one("SELECT * FROM guilds WHERE id = $1", [gid]);
  if (!g) fail(404, "Guild not found");
  if (!(user.guild_ids ?? []).includes(gid)) fail(403, "Only members of this guild can check in to its meet-ups");
  const [d] = currentSlot();
  if (await isPaidMeetupDay(d)) fail(403, PAID_DAY_MSG);
  const family = eligibleFamily(user, idList(b, "family_ids"));
  await insertCheckin({ user_id: user.user_id, date: d, session: `guild:${g.id}`, via: "guild", guild_id: g.id,
    guild_name: g.name, family }, `You're already checked in to today's ${g.name} meet-up`);
  return c.json({ ok: true, date: d, guild: g.name });
});

app.post("/api/checkin/casual", async (c) => {
  const user = await currentUser(c);
  const [d] = currentSlot();
  if (await isPaidMeetupDay(d)) fail(403, PAID_DAY_MSG);
  const family = eligibleFamily(user, idList(await body(c), "family_ids"));
  await insertCheckin({ user_id: user.user_id, date: d, session: "casual", via: "casual", family },
    "You're already checked in to a casual meetup today");
  return c.json({ ok: true, date: d });
});

app.get("/api/leaderboards/guilds", async (c) => {
  await currentUser(c);
  const cutoff = addDays(localDate(), -365);
  const guilds = await listGuilds();
  const perUser = new Map((await q(`SELECT user_id, ${STATS} FROM game_logs WHERE played_at >= $1 GROUP BY user_id`, [cutoff]))
    .map((r) => [r.user_id, r]));
  const out = guilds.map((g) => {
    const rows = g.members.map((m) => perUser.get(m.user_id)).filter(Boolean);
    const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
    let top = null;
    for (const m of g.members) {
      if (perUser.has(m.user_id) && (!top || perUser.get(m.user_id).total_score > perUser.get(top.user_id).total_score)) top = m;
    }
    return { id: g.id, name: g.name, tag: g.tag, members: g.members.length, total_score: sum("total_score"),
      games: sum("games"), wins: sum("wins"), playtime_min: sum("playtime_min"), top_player: top ? top.name : null };
  });
  return c.json({ since: cutoff, rows: out.sort((a, b) => b.total_score - a.total_score) });
});

// ---------- Quarterly subscriber top-score prize ----------
app.get("/api/leaderboards/quarterly", async (c) => {
  await currentUser(c);
  await awardQuarterPrizes();
  const today = localDate();
  const year = Number(today.slice(0, 4));
  const qtr = Math.floor((Number(today.slice(5, 7)) - 1) / 3) + 1;
  const standings = await ytdStandings(year, today);
  const winners = await q("SELECT * FROM quarter_awards WHERE winner_user_id IS NOT NULL ORDER BY year DESC, quarter DESC LIMIT 12");
  return c.json({ year, quarter: qtr, ends: quarterEnd(year, qtr), standings: standings.slice(0, 10), winners });
});

// ---------- Collections & members ----------
app.get("/api/me/collection", async (c) => {
  const user = await currentUser(c);
  return c.json(await q("SELECT * FROM collections WHERE user_id = $1 ORDER BY title LIMIT 1000", [user.user_id]));
});

app.post("/api/me/collection", async (c) => {
  const user = await currentUser(c);
  const b = await body(c);
  const category = oneOf(b, "category", ["board", "card", "digital"]);
  const title = str(b, "title", { min: 1, max: 80 });
  const platform = str(b, "platform", { max: 40, def: "" });
  if (category === "digital" && !platform.trim()) fail(400, "Pick a platform for digital games");
  return c.json(await one(`INSERT INTO collections (id, user_id, category, title, platform, created_at)
    VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
  [uid(), user.user_id, category, title.trim(), category === "digital" ? platform.trim() : "", now()]));
});

app.delete("/api/me/collection/:item_id", async (c) => {
  const user = await currentUser(c);
  if (!(await one("DELETE FROM collections WHERE id = $1 AND user_id = $2 RETURNING id", [c.req.param("item_id"), user.user_id])))
    fail(404, "Item not found");
  return c.json({ ok: true });
});

const guildMap = async () => new Map((await q("SELECT * FROM guilds")).map((g) => [g.id, g]));
const userGuilds = (u, gmap) => (u.guild_ids ?? []).filter((g) => gmap.has(g))
  .map((g) => ({ id: gmap.get(g).id, name: gmap.get(g).name, tag: gmap.get(g).tag }));

app.get("/api/members", async (c) => {
  const users = await q("SELECT * FROM users ORDER BY name LIMIT 1000");
  const counts = new Map((await q("SELECT user_id, count(*)::int AS n FROM collections GROUP BY user_id")).map((r) => [r.user_id, r.n]));
  const gmap = await guildMap();
  return c.json(users.map((u) => ({ ...publicUser(u), collection_count: counts.get(u.user_id) ?? 0, guilds: userGuilds(u, gmap) })));
});

app.get("/api/members/:user_id", async (c) => {
  const userId = c.req.param("user_id");
  const u = await getUserById(userId);
  if (!u) fail(404, "Member not found");
  const items = await q("SELECT id, category, title, platform, created_at FROM collections WHERE user_id = $1 ORDER BY title LIMIT 1000", [userId]);
  const stats = await q(`SELECT title, count(*)::int AS n, (count(*) FILTER (WHERE placement = 1))::int AS wins
    FROM game_logs WHERE user_id = $1 AND played_at >= $2 GROUP BY title ORDER BY n DESC LIMIT 200`,
  [userId, addDays(localDate(), -365)]);
  return c.json({ ...publicUser(u), guilds: userGuilds(u, await guildMap()),
    collection: Object.fromEntries(["board", "card", "digital"].map((k) => [k, items.filter((i) => i.category === k)])),
    stats: { games_logged: stats.reduce((a, s) => a + s.n, 0), wins: stats.reduce((a, s) => a + s.wins, 0),
      favourite_game: stats[0]?.title ?? null },
    member_since: u.created_at });
});

// ---------- Admin / host ----------
app.get("/api/admin/summary", async (c) => {
  const user = await requireStaff(c);
  const since = c.req.query("since");
  const latest = await one("SELECT created_at FROM checkins ORDER BY created_at DESC LIMIT 1");
  let fresh = [];
  const sinceDate = since ? new Date(since) : null;
  if (sinceDate && !Number.isNaN(sinceDate.getTime())) {
    const rows = await q(`SELECT ch.*, u.name FROM checkins ch LEFT JOIN users u ON u.user_id = ch.user_id
      WHERE ch.created_at > $1 AND ch.user_id <> $2 ORDER BY ch.created_at LIMIT 50`, [sinceDate, user.user_id]);
    fresh = rows.map((r) => ({ id: r.id, name: r.name ?? "Someone", via: r.via, session: r.session ?? "day",
      family_count: (r.family ?? []).length, created_at: r.created_at }));
  }
  const { tokens } = await one("SELECT count(*)::int AS tokens FROM token_uses WHERE NOT acknowledged");
  const { today } = await one("SELECT count(*)::int AS today FROM checkins WHERE date = $1 AND via NOT IN ('guild', 'casual')",
    [currentSlot()[0]]);
  return c.json({ unacked_tokens: tokens, checkins_today: today, latest_checkin_at: latest?.created_at ?? null, new_checkins: fresh });
});

app.get("/api/admin/token-alerts", async (c) => {
  await requireStaff(c);
  return c.json(await q("SELECT * FROM token_uses ORDER BY acknowledged, created_at DESC LIMIT 200"));
});

app.post("/api/admin/token-alerts/:alert_id/ack", async (c) => {
  const user = await requireStaff(c);
  const r = await one("UPDATE token_uses SET acknowledged = true, acknowledged_by = $2, acknowledged_at = $3 WHERE id = $1 RETURNING id",
    [c.req.param("alert_id"), user.name, now()]);
  if (!r) fail(404, "Alert not found");
  return c.json({ ok: true });
});

app.get("/api/admin/checkins", async (c) => {
  await requireStaff(c);
  const d = c.req.query("date") || currentSlot()[0];
  const rows = await q(`SELECT ch.*, u.name AS user_name, u.subscription_expires_at
    FROM checkins ch LEFT JOIN users u ON u.user_id = ch.user_id WHERE ch.date = $1 ORDER BY ch.created_at LIMIT 500`, [d]);
  const gmap = await guildMap();
  const labels = { ...SESSION_LABELS };
  for (const r of rows) {
    if (r.via === "guild") labels[r.session] = `Guild meet-up · ${gmap.get(r.guild_id)?.name || r.guild_name || "Guild"}`;
  }
  if (rows.some((r) => r.via === "casual")) labels.casual = "Casual meetup (unofficial)";
  const heads = Object.fromEntries(Object.keys(labels).map((s) => [s,
    rows.filter((r) => (r.session ?? "day") === s).reduce((a, r) => a + 1 + (r.family ?? []).length, 0)]));
  const lock = await one("SELECT * FROM paid_meetup_days WHERE date = $1", [d]);
  return c.json({ date: d, paid_meetup_day: Boolean(lock), paid_meetup_set_by: lock?.set_by ?? null,
    headcount: Object.keys(SESSION_LABELS).reduce((a, s) => a + heads[s], 0),
    session_headcount: heads, session_labels: labels,
    rows: rows.map(({ user_name, subscription_expires_at, ...r }) => ({ ...r, name: user_name ?? null, family: r.family ?? [],
      session: r.session ?? "day", is_subscriber: isSubscriber({ subscription_expires_at }) })) });
});

// Hosts mark a date as an official paid meetup: free casual and guild check-ins are switched off for that date.
app.put("/api/admin/paid-days/:date", async (c) => {
  const staff = await requireStaff(c);
  const d = c.req.param("date");
  if (!isDateStr(d)) fail(400, "Invalid date");
  if (d < addDays(localDate(), -1)) fail(400, "Pick today or a future date");
  await q(`INSERT INTO paid_meetup_days (date, set_by, created_at) VALUES ($1, $2, $3)
    ON CONFLICT (date) DO UPDATE SET set_by = EXCLUDED.set_by`, [d, staff.name, now()]);
  return c.json({ ok: true, date: d, paid_meetup_day: true });
});

app.delete("/api/admin/paid-days/:date", async (c) => {
  await requireStaff(c);
  await q("DELETE FROM paid_meetup_days WHERE date = $1", [c.req.param("date")]);
  return c.json({ ok: true, date: c.req.param("date"), paid_meetup_day: false });
});

app.get("/api/admin/paid-days", async (c) => {
  await requireStaff(c);
  return c.json(await q("SELECT * FROM paid_meetup_days WHERE date >= $1 ORDER BY date LIMIT 100", [addDays(localDate(), -1)]));
});

// Hosts can remove any check-in from the roster (e.g. a host who checked in by accident).
app.delete("/api/admin/checkins/:id", async (c) => {
  await requireStaff(c);
  const row = await one("SELECT * FROM checkins WHERE id = $1", [c.req.param("id")]);
  if (!row) fail(404, "Check-in not found");
  return c.json({ ok: true, unmarked_logs: await removeCheckin(row) });
});

app.get("/api/admin/users", async (c) => {
  await requireStaff(c);
  const [d, s] = currentSlot();
  const [users, passes, inNow] = await Promise.all([
    q("SELECT * FROM users ORDER BY name LIMIT 2000"),
    q(`SELECT user_id FROM payments WHERE product = 'checkin' AND method = 'cash' AND status = 'COMPLETED'
       AND meta->>'date' = $1 AND meta->>'session' = $2`, [d, s]),
    q("SELECT user_id FROM checkins WHERE date = $1 AND session = $2", [d, s]),
  ]);
  const paid = new Set(passes.map((r) => r.user_id));
  const checked = new Set(inNow.map((r) => r.user_id));
  return c.json(users.map((u) => ({ ...meView(u), free_entry: freeEntry(u), cash_entry_now: paid.has(u.user_id),
    checked_in_now: checked.has(u.user_id) })));
});

// A host records that a member paid the $5 admission in cash (or another way off the site) for the
// current session. The member then checks themselves in free, which lets them log meetup games.
app.post("/api/admin/users/:user_id/cash-entry", async (c) => {
  const staff = await requireStaff(c);
  const target = await getUserById(c.req.param("user_id"));
  if (!target) fail(404, "User not found");
  if (freeEntry(target)) fail(400, `${target.name} already gets free entry`);
  const [d, s] = currentSlot();
  if (await cashPass(target.user_id, d, s)) fail(400, `${target.name} is already marked as paid for this session`);
  if (await one("SELECT 1 FROM checkins WHERE user_id = $1 AND date = $2 AND session = $3", [target.user_id, d, s]))
    fail(400, `${target.name} is already checked in for this session`);
  await q(`INSERT INTO payments (checkout_id, user_id, product, label, amount_cents, currency, status, method,
      recorded_by, meta, fulfilled, created_at, paid_at)
    VALUES ($1, $2, 'checkin', 'Session Admission (paid to host)', $3, 'AUD', 'COMPLETED', 'cash', $4, $5::jsonb, false, $6, $6)`,
  [`cash_${uid()}`, target.user_id, CHECKIN_CENTS, staff.name, json({ date: d, session: s }), now()]);
  return c.json({ ok: true, date: d, session: s, label: SESSION_LABELS[s] });
});

app.delete("/api/admin/users/:user_id/cash-entry", async (c) => {
  await requireStaff(c);
  const userId = c.req.param("user_id");
  const [d, s] = currentSlot();
  if (await one("SELECT 1 FROM checkins WHERE user_id = $1 AND date = $2 AND session = $3 AND via = 'cash'", [userId, d, s]))
    fail(400, "They've already checked in with this entry, so it can't be undone");
  const r = await one(`UPDATE payments SET status = 'CANCELED' WHERE user_id = $1 AND product = 'checkin' AND method = 'cash'
      AND status = 'COMPLETED' AND meta->>'date' = $2 AND meta->>'session' = $3 RETURNING checkout_id`, [userId, d, s]);
  if (!r) fail(404, "No paid entry recorded for this session");
  return c.json({ ok: true });
});

app.post("/api/admin/users/:user_id/role", async (c) => {
  await requireAdmin(c);
  const role = oneOf(await body(c), "role", ["member", "host"]);
  const target = await getUserById(c.req.param("user_id"));
  if (!target) fail(404, "User not found");
  if (target.role === "admin") fail(400, "Admin role can't be changed here");
  await q("UPDATE users SET role = $2 WHERE user_id = $1", [target.user_id, role]);
  return c.json({ ok: true, role });
});

app.post("/api/admin/users/:user_id/grant-membership", async (c) => {
  const admin = await requireAdmin(c);
  const userId = c.req.param("user_id");
  if (!(await getUserById(userId))) fail(404, "User not found");
  const p = await one(`INSERT INTO payments (checkout_id, user_id, product, label, amount_cents, currency, status, method,
      recorded_by, meta, created_at, paid_at)
    VALUES ($1, $2, 'annual', 'Annual Membership (cash at door)', $3, 'AUD', 'COMPLETED', 'cash', $4, '{}'::jsonb, $5, $5) RETURNING *`,
  [`cash_${uid()}`, userId, ANNUAL_CENTS, admin.name, now()]);
  await fulfil(p);
  return c.json(meView(await getUserById(userId)));
});

app.get("/api/admin/sessions", async (c) => {
  await requireStaff(c);
  const d = c.req.query("date") || currentSlot()[0];
  if (!isDateStr(d)) fail(400, "Invalid date");
  const logs = await q(`SELECT g.*, u.name FROM game_logs g LEFT JOIN users u ON u.user_id = g.user_id
    WHERE g.played_at = $1 AND g.at_meetup LIMIT 2000`, [d]);
  const games = new Map();
  for (const lg of logs) {
    if (!games.has(lg.title_key)) games.set(lg.title_key, { title: lg.title, genre: lg.genre, plays: 0, minutes: 0, players: new Set(), entries: [] });
    const g = games.get(lg.title_key);
    g.plays += 1;
    g.minutes += lg.playtime_min;
    g.players.add(lg.user_id);
    g.entries.push({ id: lg.id, name: lg.name ?? "Player", player_id: lg.player_id, score: lg.score, placement: lg.placement,
      player_count: lg.player_count, playtime_min: lg.playtime_min });
  }
  const out = [...games.values()].sort((a, b) => b.plays - a.plays).map((g) => ({
    ...g, entries: g.entries.sort((a, b) => a.placement - b.placement || (b.score ?? -Infinity) - (a.score ?? -Infinity)), players: g.players.size }));
  const recent = (await q("SELECT date FROM checkins UNION SELECT played_at FROM game_logs ORDER BY 1 DESC LIMIT 30")).map((r) => r.date);
  const dayRows = await q("SELECT family FROM checkins WHERE date = $1 LIMIT 500", [d]);
  return c.json({ date: d, attendees: dayRows.reduce((a, r) => a + 1 + (r.family ?? []).length, 0), logs: logs.length,
    loggers: new Set(logs.map((lg) => lg.user_id)).size, games: out, recent_dates: recent });
});

app.post("/api/admin/prizes", async (c) => {
  const staff = await requireStaff(c);
  const b = await body(c);
  const userId = str(b, "user_id");
  const prize = str(b, "prize", { min: 1, max: 120 }).trim();
  const event = str(b, "event", { max: 120, def: "" }).trim();
  const wonAt = str(b, "won_at", { optional: true });
  const u = await getUserById(userId);
  if (!u) fail(404, "User not found");
  const today = localDate();
  const won = wonAt || today;
  if (!isDateStr(won)) fail(400, "Invalid date");
  if (won > today || won < addDays(today, -365)) fail(400, "Win date must be within the last year and not in the future");
  return c.json(await one(`INSERT INTO prizes (id, user_id, user_name, prize, event, won_at, collect_by, collected, recorded_by, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, false, $8, $9) RETURNING *`,
  [uid(), userId, u.name, prize, event, won, addMonths(won, 3), staff.name, now()]));
});

app.get("/api/admin/prizes", async (c) => {
  await requireStaff(c);
  return c.json(await q("SELECT * FROM prizes ORDER BY collected, collect_by LIMIT 500"));
});

app.post("/api/admin/prizes/:prize_id/collected", async (c) => {
  const staff = await requireStaff(c);
  const r = await one(`UPDATE prizes SET collected = true, collected_at = $2, handed_over_by = $3
    WHERE id = $1 AND NOT collected RETURNING id`, [c.req.param("prize_id"), now(), staff.name]);
  if (!r) fail(404, "Prize not found or already collected");
  return c.json({ ok: true });
});

app.get("/api/stats/monthly", async (c) => {
  await currentUser(c);
  const lp = localParts();
  const cutoff = addMonths(dateStr(lp.year, lp.month), -11);
  const rows = await q(`SELECT substr(played_at, 1, 7) AS m, (array_agg(title ORDER BY created_at))[1] AS title,
      count(*)::int AS plays, count(DISTINCT user_id)::int AS players, sum(playtime_min)::float8 AS minutes
    FROM game_logs WHERE played_at >= $1 GROUP BY 1, title_key`, [cutoff]);
  const months = new Map();
  for (const r of rows) {
    if (!months.has(r.m)) months.set(r.m, []);
    months.get(r.m).push({ title: r.title, plays: r.plays, players: r.players, minutes: r.minutes });
  }
  return c.json([...months.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([month, gs]) => ({
    month, total_plays: gs.reduce((a, g) => a + g.plays, 0), distinct_games: gs.length,
    top: [...gs].sort((a, b) => b.plays - a.plays || b.players - a.players).slice(0, 5) })));
});

app.get("/api/games/details", async (c) => {
  const raw = c.req.query("q") ?? "";
  if (raw.length < 2 || raw.length > 60 || raw.trim().length < 2) fail(422, "Search must be at least 2 characters");
  const pattern = `%${raw.trim().replace(/[\\%_]/g, "\\$&")}%`;
  const cutoff = addDays(localDate(), -365);
  const items = await q(`SELECT ch.*, u.name, u.picture FROM collections ch JOIN users u ON u.user_id = ch.user_id
    WHERE ch.title ILIKE $1 LIMIT 500`, [pattern]);
  const logs = await q(`SELECT g.*, u.name FROM game_logs g LEFT JOIN users u ON u.user_id = g.user_id
    WHERE g.title ILIKE $1 AND g.played_at >= $2 ORDER BY g.played_at DESC, g.created_at DESC LIMIT 1000`, [pattern, cutoff]);
  const owners = new Map();
  for (const i of items) {
    if (!owners.has(i.user_id)) owners.set(i.user_id, { user_id: i.user_id, name: i.name, picture: i.picture ?? null, copies: [] });
    owners.get(i.user_id).copies.push({ title: i.title, category: i.category, platform: i.platform ?? "" });
  }
  const recent = logs.slice(0, 10).map((lg) => ({ id: lg.id, user_id: lg.user_id, name: lg.name ?? "Player", title: lg.title,
    score: lg.score, placement: lg.placement, player_count: lg.player_count, played_at: lg.played_at }));
  return c.json({ owners: [...owners.values()].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase())), recent,
    stats: { plays: logs.length, players: new Set(logs.map((lg) => lg.user_id)).size,
      top_score: logs.some((lg) => lg.score !== null) ? Math.max(...logs.filter((lg) => lg.score !== null).map((lg) => lg.score)) : null } });
});

// ---------- One-off MongoDB import (admin only; used by scripts/import-mongo.mjs) ----------
app.post("/api/admin/import/:collection", async (c) => {
  await requireAdmin(c);
  const b = await body(c);
  if (!Array.isArray(b.docs)) fail(422, "docs must be a list");
  const result = await importCollection(c.req.param("collection"), b.docs);
  if (c.req.param("collection") === "users") await seedAdmin();
  return c.json(result);
});

app.get("/api", (c) => c.json({ message: "Murray Bridge Games Group API" }));
app.get("/api/", (c) => c.json({ message: "Murray Bridge Games Group API" }));
app.all("/api/*", (c) => c.json({ detail: "Not Found" }, 404));

// Any other path is a client-side route of the React app: serve its index.html.
app.get("*", async (c) => {
  const res = await fetch(new URL("/index.html", publicOrigin(c)));
  return new Response(res.body, { status: res.ok ? 200 : res.status, headers: { "content-type": "text/html; charset=utf-8" } });
});

export default app;
