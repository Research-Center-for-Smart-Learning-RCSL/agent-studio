CREATE TABLE "request_logs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "request_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"ts" timestamp with time zone NOT NULL,
	"source" text NOT NULL,
	"event" text NOT NULL,
	"route" text,
	"status" integer,
	"ms" integer,
	"project_id" text,
	"agent_id" text,
	"detail" jsonb
);
--> statement-breakpoint
CREATE INDEX "request_logs_ts_idx" ON "request_logs" USING btree ("ts");--> statement-breakpoint
CREATE INDEX "request_logs_source_event_ts_idx" ON "request_logs" USING btree ("source","event","ts");