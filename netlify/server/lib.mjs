// Shared helpers for the MBGG API: database access, Adelaide-time date maths, validation and errors.
import { randomBytes, randomUUID } from "node:crypto";
import { getDatabase } from "@netlify/database";
import { HTTPException } from "hono/http-exception";

// ---------- Database ----------
let conn;
const pool = () => (conn ??= getDatabase()).pool;

/** Run a parameterised query and return its rows. */
export const q = async (text, params = []) => (await pool().query(text, params)).rows;
/** Run a query and return the first row, or null. */
export const one = async (text, params = []) => (await q(text, params))[0] ?? null;
/** Postgres unique_violation, the equivalent of Mongo's DuplicateKeyError. */
export const isDuplicate = (e) => e?.code === "23505";
/** jsonb parameters must be serialised explicitly (pg would turn JS arrays into Postgres arrays). */
export const json = (v) => JSON.stringify(v ?? null);

// ---------- Ids ----------
export const hex = (bytes = 16) => randomBytes(bytes).toString("hex");
export const uid = () => randomUUID().replaceAll("-", "");

// ---------- Errors ----------
export const fail = (status, detail) => {
  throw new HTTPException(status, { message: detail });
};

// ---------- Time (all group logic runs on Australia/Adelaide time) ----------
const TZ = "Australia/Adelaide";
const fmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
});
const pad = (n) => String(n).padStart(2, "0");

export const now = () => new Date();

/** Local Adelaide parts for an instant. */
export const localParts = (d = now()) => {
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
  return { year: Number(p.year), month: Number(p.month), day: Number(p.day), hour: Number(p.hour) };
};
/** "YYYY-MM-DD" in Adelaide for an instant. */
export const localDate = (d = now()) => {
  const p = localParts(d);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
};
export const localMonth = (d = now()) => localDate(d).slice(0, 7);

const toUTC = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const fromUTC = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

export const isDateStr = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && fromUTC(toUTC(s)) === s;
export const addDays = (s, n) => {
  const d = toUTC(s);
  d.setUTCDate(d.getUTCDate() + n);
  return fromUTC(d);
};
/** Calendar month arithmetic that clamps to month end, like dateutil's relativedelta. */
export const addMonths = (s, n) => {
  const [y, m, d] = s.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = total % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${ny}-${pad(nm + 1)}-${pad(Math.min(d, last))}`;
};
export const dateStr = (y, m, d = 1) => `${y}-${pad(m)}-${pad(d)}`;

export const SESSION_LABELS = { day: "Day session (10am–2pm)", evening: "Evening session (4pm–late)" };

/** Evening sessions run past midnight: before 5am counts as the previous day's evening. */
export const currentSlot = () => {
  const t = localParts();
  const today = dateStr(t.year, t.month, t.day);
  if (t.hour < 5) return [addDays(today, -1), "evening"];
  return [today, t.hour < 15 ? "day" : "evening"];
};

// ---------- Validation ----------
export const body = async (c) => {
  try {
    const b = await c.req.json();
    return b && typeof b === "object" && !Array.isArray(b) ? b : {};
  } catch {
    return {};
  }
};

/** String field check with pydantic-like rules (lengths measured before trimming). */
export const str = (b, key, { min = 0, max = Infinity, optional = false, def } = {}) => {
  const v = b[key];
  if (v === undefined || v === null) {
    if (def !== undefined) return def;
    if (optional) return undefined;
    fail(422, `${key} is required`);
  }
  if (typeof v !== "string") fail(422, `${key} must be text`);
  if (v.length < min) fail(422, min === 1 ? `${key} can't be empty` : `${key} must be at least ${min} characters`);
  if (v.length > max) fail(422, `${key} must be at most ${max} characters`);
  return v;
};

export const int = (b, key, { min = -Infinity, max = Infinity, optional = false, def } = {}) => {
  let v = b[key];
  if (v === undefined || v === null || v === "") {
    if (def !== undefined) return def;
    if (optional) return undefined;
    fail(422, `${key} is required`);
  }
  if (typeof v === "string" && /^-?\d+$/.test(v.trim())) v = Number(v);
  if (!Number.isInteger(v)) fail(422, `${key} must be a whole number`);
  if (v < min || v > max) fail(422, `${key} must be between ${min} and ${max}`);
  return v;
};

export const idList = (b, key, max = 10) => {
  const v = b[key] ?? [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) fail(422, `${key} must be a list`);
  if (v.length > max) fail(422, `${key} can have at most ${max} items`);
  return v;
};

export const oneOf = (b, key, options, def) => {
  const v = b[key] ?? def;
  if (!options.includes(v)) fail(422, `${key} must be one of: ${options.join(", ")}`);
  return v;
};
