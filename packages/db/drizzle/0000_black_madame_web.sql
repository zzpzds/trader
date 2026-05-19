CREATE TABLE "monitoring_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"strategy_id" text NOT NULL,
	"run_date" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"analysis" text,
	"has_action_items" boolean,
	"prices" jsonb,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"monitoring_run_id" text NOT NULL,
	"title" text NOT NULL,
	"content" text,
	"is_read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "position_lots" (
	"id" text PRIMARY KEY NOT NULL,
	"position_id" text NOT NULL,
	"shares" integer NOT NULL,
	"cost_price" numeric(15, 4) NOT NULL,
	"lot_date" text NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"id" text PRIMARY KEY NOT NULL,
	"strategy_id" text NOT NULL,
	"symbol" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "strategies" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"symbols" jsonb NOT NULL,
	"content" text NOT NULL,
	"script" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "monitoring_runs" ADD CONSTRAINT "monitoring_runs_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_monitoring_run_id_monitoring_runs_id_fk" FOREIGN KEY ("monitoring_run_id") REFERENCES "public"."monitoring_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_lots" ADD CONSTRAINT "position_lots_position_id_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "monitoring_runs_strategy_date_idx" ON "monitoring_runs" USING btree ("strategy_id","run_date");--> statement-breakpoint
CREATE UNIQUE INDEX "positions_strategy_id_symbol_idx" ON "positions" USING btree ("strategy_id","symbol");