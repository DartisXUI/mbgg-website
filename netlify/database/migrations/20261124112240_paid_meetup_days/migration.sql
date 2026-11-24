CREATE TABLE "paid_meetup_days" (
	"date" text PRIMARY KEY,
	"set_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
