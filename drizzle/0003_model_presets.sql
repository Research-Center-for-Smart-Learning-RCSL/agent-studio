CREATE TABLE "model_presets" (
	"model" text PRIMARY KEY NOT NULL,
	"costly" boolean DEFAULT false NOT NULL,
	"position" integer NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "model_presets" ("model", "costly", "position") VALUES
	('gpt-6-luna', false, 0),
	('gpt-6.1-terra', false, 1),
	('gpt-6.2-sol', true, 2),
	('gpt-6.2-astra', true, 3);
