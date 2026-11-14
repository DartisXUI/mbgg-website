CREATE TABLE "checkins" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"date" text NOT NULL,
	"session" text DEFAULT 'day' NOT NULL,
	"via" text NOT NULL,
	"family" jsonb DEFAULT '[]' NOT NULL,
	"guild_id" text,
	"guild_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collections" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"platform" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_logs" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"title_key" text NOT NULL,
	"genre" text NOT NULL,
	"player_count" integer NOT NULL,
	"player_id" text NOT NULL,
	"playtime_min" integer NOT NULL,
	"score" integer NOT NULL,
	"placement" integer NOT NULL,
	"played_at" text NOT NULL,
	"at_meetup" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guilds" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"tag" text NOT NULL UNIQUE,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"id" serial PRIMARY KEY,
	"email" text NOT NULL,
	"ip" text DEFAULT '' NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"checkout_id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"product" text NOT NULL,
	"label" text,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'AUD' NOT NULL,
	"status" text NOT NULL,
	"method" text,
	"recorded_by" text,
	"meta" jsonb DEFAULT '{}' NOT NULL,
	"result" jsonb,
	"fulfilled" boolean DEFAULT false NOT NULL,
	"square_order_id" text,
	"square_link_id" text,
	"square_payment_id" text,
	"checkout_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "prizes" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"user_name" text,
	"prize" text NOT NULL,
	"event" text DEFAULT '' NOT NULL,
	"won_at" text NOT NULL,
	"collect_by" text NOT NULL,
	"collected" boolean DEFAULT false NOT NULL,
	"recorded_by" text,
	"collected_at" timestamp with time zone,
	"handed_over_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quarter_awards" (
	"id" text PRIMARY KEY,
	"year" integer NOT NULL,
	"quarter" integer NOT NULL,
	"label" text NOT NULL,
	"end" text NOT NULL,
	"winner_user_id" text,
	"winner_name" text,
	"total_score" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raffle_bonuses" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"year" integer NOT NULL,
	"period" integer NOT NULL,
	"label" text NOT NULL,
	"entries" integer NOT NULL,
	"raffle_year" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raffle_entries" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"year" integer NOT NULL,
	"number" integer NOT NULL,
	"source" text DEFAULT 'purchase' NOT NULL,
	"ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "token_uses" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"user_name" text,
	"month" text NOT NULL,
	"game" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"acknowledged" boolean DEFAULT false NOT NULL,
	"acknowledged_by" text,
	"acknowledged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_sessions" (
	"session_token" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"user_id" text PRIMARY KEY,
	"email" text NOT NULL UNIQUE,
	"name" text NOT NULL,
	"picture" text,
	"role" text DEFAULT 'member' NOT NULL,
	"player_tag" text DEFAULT '' NOT NULL,
	"bio" text DEFAULT '' NOT NULL,
	"password_hash" text,
	"subscription_expires_at" timestamp with time zone,
	"subscription_started_at" timestamp with time zone,
	"family" jsonb DEFAULT '[]' NOT NULL,
	"guild_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "checkins_user_date_session_idx" ON "checkins" ("user_id","date","session");--> statement-breakpoint
CREATE INDEX "checkins_date_idx" ON "checkins" ("date");--> statement-breakpoint
CREATE INDEX "checkins_created_idx" ON "checkins" ("created_at");--> statement-breakpoint
CREATE INDEX "collections_user_cat_idx" ON "collections" ("user_id","category");--> statement-breakpoint
CREATE INDEX "game_logs_user_played_idx" ON "game_logs" ("user_id","played_at");--> statement-breakpoint
CREATE INDEX "game_logs_played_title_idx" ON "game_logs" ("played_at","title_key");--> statement-breakpoint
CREATE INDEX "login_attempts_email_at_idx" ON "login_attempts" ("email","at");--> statement-breakpoint
CREATE INDEX "payments_user_created_idx" ON "payments" ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "prizes_user_collect_idx" ON "prizes" ("user_id","collect_by");--> statement-breakpoint
CREATE INDEX "prizes_collected_by_idx" ON "prizes" ("collected","collect_by");--> statement-breakpoint
CREATE UNIQUE INDEX "quarter_awards_year_quarter_idx" ON "quarter_awards" ("year","quarter");--> statement-breakpoint
CREATE UNIQUE INDEX "raffle_bonuses_user_period_idx" ON "raffle_bonuses" ("user_id","year","period");--> statement-breakpoint
CREATE UNIQUE INDEX "raffle_entries_year_number_idx" ON "raffle_entries" ("year","number");--> statement-breakpoint
CREATE INDEX "raffle_entries_user_year_idx" ON "raffle_entries" ("user_id","year");--> statement-breakpoint
CREATE UNIQUE INDEX "token_uses_user_month_idx" ON "token_uses" ("user_id","month");--> statement-breakpoint
CREATE INDEX "token_uses_ack_created_idx" ON "token_uses" ("acknowledged","created_at");--> statement-breakpoint
CREATE INDEX "user_sessions_user_idx" ON "user_sessions" ("user_id");