-- CreateTable
CREATE TABLE IF NOT EXISTS "plans" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "price_monthly" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "price_yearly" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "chat_messages" INTEGER NOT NULL DEFAULT 100,
    "voice_minutes" INTEGER NOT NULL DEFAULT 10,
    "quiz_generations" INTEGER NOT NULL DEFAULT 5,
    "kb_uploads" INTEGER NOT NULL DEFAULT 3,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "user_plans" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),

    CONSTRAINT "user_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "usage_records" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "period_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "plans_name_key" ON "plans"("name");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "user_plans_user_id_idx" ON "user_plans"("user_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "user_plans_plan_id_idx" ON "user_plans"("plan_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "usage_records_user_id_metric_period_key_idx" ON "usage_records"("user_id", "metric", "period_key");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'user_plans_plan_id_fkey'
    ) THEN
        ALTER TABLE "user_plans"
            ADD CONSTRAINT "user_plans_plan_id_fkey"
            FOREIGN KEY ("plan_id") REFERENCES "plans"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;
