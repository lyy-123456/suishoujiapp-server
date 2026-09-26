CREATE SEQUENCE "public"."change_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "app_user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text,
	"password_hash" text NOT NULL,
	"nickname" text DEFAULT '' NOT NULL,
	"role" text DEFAULT 'user' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"token_version" integer DEFAULT 0 NOT NULL,
	"totp_secret" text,
	"last_login_at" timestamp with time zone,
	"last_login_ip" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset" (
	"id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"seq" bigint DEFAULT nextval('change_seq') NOT NULL,
	"client_updated_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"category_id" text NOT NULL,
	"purchase_price" numeric(12, 2) NOT NULL,
	"purchase_date" date NOT NULL,
	"image_file_id" uuid,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"expected_life_days" integer,
	"sell_price" numeric(12, 2),
	"end_date" date,
	"profit_loss" numeric(12, 2),
	"actual_daily_cost" numeric(12, 4),
	"source" text DEFAULT 'user' NOT NULL,
	CONSTRAINT "asset_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"target_type" text DEFAULT '' NOT NULL,
	"target_id" text DEFAULT '' NOT NULL,
	"ip" text DEFAULT '' NOT NULL,
	"user_agent" text DEFAULT '' NOT NULL,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "category" (
	"id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"seq" bigint DEFAULT nextval('change_seq') NOT NULL,
	"client_updated_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"icon" text DEFAULT '' NOT NULL,
	"color" text DEFAULT '' NOT NULL,
	"is_preset" boolean DEFAULT false NOT NULL,
	"source" text DEFAULT 'user' NOT NULL,
	CONSTRAINT "category_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "experience" (
	"id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"seq" bigint DEFAULT nextval('change_seq') NOT NULL,
	"client_updated_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"city" text DEFAULT '' NOT NULL,
	"location" text,
	"shop_name" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"rating" integer,
	"image_file_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"experience_date" date NOT NULL,
	"lat" numeric(9, 6),
	"lng" numeric(9, 6),
	"source" text DEFAULT 'user' NOT NULL,
	CONSTRAINT "experience_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "file_object" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"object_key" text DEFAULT '' NOT NULL,
	"mime" text DEFAULT '' NOT NULL,
	"size" integer DEFAULT 0 NOT NULL,
	"sha256" text DEFAULT '' NOT NULL,
	"width" integer,
	"height" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "meal_record" (
	"id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"seq" bigint DEFAULT nextval('change_seq') NOT NULL,
	"client_updated_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"meal_date" date NOT NULL,
	"meal_time" text,
	"item" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"meal_type" text,
	"note" text,
	"source" text DEFAULT 'user' NOT NULL,
	CONSTRAINT "meal_record_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "sync_op_log" (
	"op_id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"entity" text NOT NULL,
	"status" text NOT NULL,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"device_name" text DEFAULT '' NOT NULL,
	"user_agent" text DEFAULT '' NOT NULL,
	"ip" text DEFAULT '' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_setting" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"seq" bigint DEFAULT nextval('change_seq') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wish_item" (
	"id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"seq" bigint DEFAULT nextval('change_seq') NOT NULL,
	"client_updated_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"target_price" numeric(12, 2) DEFAULT '0' NOT NULL,
	"saved_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"monthly_saving" numeric(12, 2),
	"target_date" date,
	"note" text,
	"image_file_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"source" text DEFAULT 'user' NOT NULL,
	CONSTRAINT "wish_item_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_image_file_id_file_object_id_fk" FOREIGN KEY ("image_file_id") REFERENCES "public"."file_object"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_app_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category" ADD CONSTRAINT "category_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experience" ADD CONSTRAINT "experience_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_object" ADD CONSTRAINT "file_object_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_record" ADD CONSTRAINT "meal_record_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_op_log" ADD CONSTRAINT "sync_op_log_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_session" ADD CONSTRAINT "user_session_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_setting" ADD CONSTRAINT "user_setting_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wish_item" ADD CONSTRAINT "wish_item_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wish_item" ADD CONSTRAINT "wish_item_image_file_id_file_object_id_fk" FOREIGN KEY ("image_file_id") REFERENCES "public"."file_object"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "app_user_email_idx" ON "app_user" USING btree ("email");--> statement-breakpoint
CREATE INDEX "asset_seq_idx" ON "asset" USING btree ("user_id","seq");--> statement-breakpoint
CREATE INDEX "asset_live_idx" ON "asset" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "audit_log_created_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "audit_log" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "category_seq_idx" ON "category" USING btree ("user_id","seq");--> statement-breakpoint
CREATE INDEX "experience_seq_idx" ON "experience" USING btree ("user_id","seq");--> statement-breakpoint
CREATE INDEX "experience_city_idx" ON "experience" USING btree ("user_id","city");--> statement-breakpoint
CREATE UNIQUE INDEX "file_object_user_sha_idx" ON "file_object" USING btree ("user_id","sha256");--> statement-breakpoint
CREATE INDEX "file_object_user_idx" ON "file_object" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "meal_record_seq_idx" ON "meal_record" USING btree ("user_id","seq");--> statement-breakpoint
CREATE INDEX "meal_record_date_idx" ON "meal_record" USING btree ("user_id","meal_date");--> statement-breakpoint
CREATE INDEX "sync_op_log_user_idx" ON "sync_op_log" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_session_token_idx" ON "user_session" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "user_session_user_idx" ON "user_session" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "wish_item_seq_idx" ON "wish_item" USING btree ("user_id","seq");