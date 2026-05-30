-- CreateTable
CREATE TABLE "ai_cost_records" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "audio_duration_secs" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "estimated_cost_usd" DOUBLE PRECISION NOT NULL,
    "period_key" TEXT NOT NULL,
    "session_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_cost_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_cost_records_user_id_period_key_idx" ON "ai_cost_records"("user_id", "period_key");

-- CreateIndex
CREATE INDEX "ai_cost_records_period_key_idx" ON "ai_cost_records"("period_key");

-- CreateIndex
CREATE INDEX "ai_cost_records_capability_idx" ON "ai_cost_records"("capability");
