CREATE TABLE "memories" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"kind" text DEFAULT 'note' NOT NULL,
	"strategy_id" text,
	"symbol" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "news_summaries" (
	"id" text PRIMARY KEY NOT NULL,
	"strategy_id" text NOT NULL,
	"summary_date" text NOT NULL,
	"content" text NOT NULL,
	"raw_articles" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_snapshots" (
	"symbol" text NOT NULL,
	"date" date NOT NULL,
	"open" numeric(15, 4) NOT NULL,
	"high" numeric(15, 4) NOT NULL,
	"low" numeric(15, 4) NOT NULL,
	"close" numeric(15, 4) NOT NULL,
	"volume" bigint,
	"fetched_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "price_snapshots_symbol_date_pk" PRIMARY KEY("symbol","date")
);
--> statement-breakpoint
CREATE TABLE "skills" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text,
	"body_md" text NOT NULL,
	"source" text DEFAULT 'user' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "skills_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "strategy_skills" (
	"strategy_id" text NOT NULL,
	"skill_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "strategy_skills_strategy_id_skill_id_pk" PRIMARY KEY("strategy_id","skill_id")
);
--> statement-breakpoint
ALTER TABLE "positions" DROP CONSTRAINT "positions_strategy_id_strategies_id_fk";
--> statement-breakpoint
DROP INDEX "positions_strategy_id_symbol_idx";--> statement-breakpoint
ALTER TABLE "position_lots" ALTER COLUMN "shares" SET DATA TYPE numeric(15, 4);--> statement-breakpoint
ALTER TABLE "positions" ALTER COLUMN "strategy_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "monitoring_runs" ADD COLUMN "skill_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "position_lots" ADD COLUMN "type" text DEFAULT 'BUY' NOT NULL;--> statement-breakpoint
ALTER TABLE "positions" ADD COLUMN "reference_price" numeric(15, 4);--> statement-breakpoint
ALTER TABLE "strategies" ADD COLUMN "analysis_window_days" integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news_summaries" ADD CONSTRAINT "news_summaries_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_skills" ADD CONSTRAINT "strategy_skills_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_skills" ADD CONSTRAINT "strategy_skills_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memories_strategy_idx" ON "memories" USING btree ("strategy_id");--> statement-breakpoint
CREATE INDEX "memories_symbol_idx" ON "memories" USING btree ("symbol");--> statement-breakpoint
CREATE INDEX "memories_pinned_idx" ON "memories" USING btree ("pinned");--> statement-breakpoint
CREATE UNIQUE INDEX "news_summaries_strategy_date_idx" ON "news_summaries" USING btree ("strategy_id","summary_date");--> statement-breakpoint
CREATE INDEX "price_snapshots_symbol_date_desc_idx" ON "price_snapshots" USING btree ("symbol","date" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_strategy_id_symbol_idx" UNIQUE NULLS NOT DISTINCT("strategy_id","symbol");