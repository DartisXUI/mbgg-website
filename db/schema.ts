// Netlify Database (Postgres) schema for the Murray Bridge Games Group API.
// Each table mirrors a collection from the original MongoDB backend.
// Date-only fields ("YYYY-MM-DD") are stored as text so they compare and serialise exactly as before.
import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const created = () => ts("created_at").notNull().defaultNow();

export const users = pgTable("users", {
  user_id: text().primaryKey(),
  email: text().notNull().unique(),
  name: text().notNull(),
  picture: text(),
  role: text().notNull().default("member"),
  player_tag: text().notNull().default(""),
  bio: text().notNull().default(""),
  password_hash: text(),
  subscription_expires_at: ts("subscription_expires_at"),
  subscription_started_at: ts("subscription_started_at"),
  family: jsonb().notNull().default(sql`'[]'::jsonb`),
  guild_ids: text().array().notNull().default(sql`'{}'::text[]`),
  created_at: created(),
});

export const userSessions = pgTable("user_sessions", {
  session_token: text().primaryKey(),
  user_id: text().notNull(),
  expires_at: ts("expires_at").notNull(),
  created_at: created(),
}, (t) => [index("user_sessions_user_idx").on(t.user_id)]);

export const loginAttempts = pgTable("login_attempts", {
  id: serial().primaryKey(),
  email: text().notNull(),
  ip: text().notNull().default(""),
  at: ts("at").notNull().defaultNow(),
}, (t) => [index("login_attempts_email_at_idx").on(t.email, t.at)]);

export const payments = pgTable("payments", {
  checkout_id: text().primaryKey(),
  user_id: text().notNull(),
  product: text().notNull(),
  label: text(),
  amount_cents: integer().notNull(),
  currency: text().notNull().default("AUD"),
  status: text().notNull(),
  method: text(),
  recorded_by: text(),
  meta: jsonb().notNull().default(sql`'{}'::jsonb`),
  result: jsonb(),
  fulfilled: boolean().notNull().default(false),
  square_order_id: text(),
  square_link_id: text(),
  square_payment_id: text(),
  checkout_url: text(),
  created_at: created(),
  paid_at: ts("paid_at"),
}, (t) => [index("payments_user_created_idx").on(t.user_id, t.created_at)]);

export const checkins = pgTable("checkins", {
  id: text().primaryKey(),
  user_id: text().notNull(),
  date: text().notNull(),
  session: text().notNull().default("day"),
  via: text().notNull(),
  family: jsonb().notNull().default(sql`'[]'::jsonb`),
  guild_id: text(),
  guild_name: text(),
  created_at: created(),
}, (t) => [
  uniqueIndex("checkins_user_date_session_idx").on(t.user_id, t.date, t.session),
  index("checkins_date_idx").on(t.date),
  index("checkins_created_idx").on(t.created_at),
]);

export const gameLogs = pgTable("game_logs", {
  id: text().primaryKey(),
  user_id: text().notNull(),
  title: text().notNull(),
  title_key: text().notNull(),
  genre: text().notNull(),
  player_count: integer().notNull(),
  player_id: text().notNull(),
  playtime_min: integer().notNull(),
  score: integer(),
  placement: integer().notNull(),
  played_at: text().notNull(),
  at_meetup: boolean().notNull().default(false),
  created_at: created(),
}, (t) => [
  index("game_logs_user_played_idx").on(t.user_id, t.played_at),
  index("game_logs_played_title_idx").on(t.played_at, t.title_key),
]);

export const tokenUses = pgTable("token_uses", {
  id: text().primaryKey(),
  user_id: text().notNull(),
  user_name: text(),
  month: text().notNull(),
  game: text().notNull(),
  note: text().notNull().default(""),
  acknowledged: boolean().notNull().default(false),
  acknowledged_by: text(),
  acknowledged_at: ts("acknowledged_at"),
  created_at: created(),
}, (t) => [
  uniqueIndex("token_uses_user_month_idx").on(t.user_id, t.month),
  index("token_uses_ack_created_idx").on(t.acknowledged, t.created_at),
]);

export const raffleEntries = pgTable("raffle_entries", {
  id: text().primaryKey(),
  user_id: text().notNull(),
  year: integer().notNull(),
  number: integer().notNull(),
  source: text().notNull().default("purchase"),
  ref: text(),
  created_at: created(),
}, (t) => [
  uniqueIndex("raffle_entries_year_number_idx").on(t.year, t.number),
  index("raffle_entries_user_year_idx").on(t.user_id, t.year),
]);

export const collections = pgTable("collections", {
  id: text().primaryKey(),
  user_id: text().notNull(),
  category: text().notNull(),
  title: text().notNull(),
  platform: text().notNull().default(""),
  created_at: created(),
}, (t) => [index("collections_user_cat_idx").on(t.user_id, t.category)]);

export const guilds = pgTable("guilds", {
  id: text().primaryKey(),
  name: text().notNull(),
  tag: text().notNull().unique(),
  created_at: created(),
});

export const quarterAwards = pgTable("quarter_awards", {
  id: text().primaryKey(),
  year: integer().notNull(),
  quarter: integer().notNull(),
  label: text().notNull(),
  end: text().notNull(),
  winner_user_id: text(),
  winner_name: text(),
  total_score: integer(),
  created_at: created(),
}, (t) => [uniqueIndex("quarter_awards_year_quarter_idx").on(t.year, t.quarter)]);

export const raffleBonuses = pgTable("raffle_bonuses", {
  id: text().primaryKey(),
  user_id: text().notNull(),
  year: integer().notNull(),
  period: integer().notNull(),
  label: text().notNull(),
  entries: integer().notNull(),
  raffle_year: integer().notNull(),
  created_at: created(),
}, (t) => [uniqueIndex("raffle_bonuses_user_period_idx").on(t.user_id, t.year, t.period)]);

export const prizes = pgTable("prizes", {
  id: text().primaryKey(),
  user_id: text().notNull(),
  user_name: text(),
  prize: text().notNull(),
  event: text().notNull().default(""),
  won_at: text().notNull(),
  collect_by: text().notNull(),
  collected: boolean().notNull().default(false),
  recorded_by: text(),
  collected_at: ts("collected_at"),
  handed_over_by: text(),
  created_at: created(),
}, (t) => [
  index("prizes_user_collect_idx").on(t.user_id, t.collect_by),
  index("prizes_collected_by_idx").on(t.collected, t.collect_by),
]);

// Days a host has marked as an official paid meetup. On these dates the free casual and guild check-ins are
// switched off, so the only way in is the $5 check-in (free for subscribers, hosts and cash payers).
export const paidMeetupDays = pgTable("paid_meetup_days", {
  date: text().primaryKey(),
  set_by: text(),
  created_at: created(),
});
