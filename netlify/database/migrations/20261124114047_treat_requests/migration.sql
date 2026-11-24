CREATE TABLE "treat_requests" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"user_name" text,
	"date" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"acknowledged" boolean DEFAULT false NOT NULL,
	"acknowledged_by" text,
	"acknowledged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "treat_requests_user_date_idx" ON "treat_requests" ("user_id","date");--> statement-breakpoint
CREATE INDEX "treat_requests_ack_date_idx" ON "treat_requests" ("acknowledged","date");