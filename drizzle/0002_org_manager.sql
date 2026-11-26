ALTER TYPE "public"."role" ADD VALUE 'manager';--> statement-breakpoint
ALTER TABLE "secrets" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "secrets" ADD CONSTRAINT "secrets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;