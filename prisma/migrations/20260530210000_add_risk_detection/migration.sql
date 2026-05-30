-- CreateTable
CREATE TABLE "user_risk_flags" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "risk_type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'open',
    "reviewed_by" TEXT,
    "review_note" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_risk_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_login_events" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "ip_address" TEXT NOT NULL,
    "user_agent" TEXT NOT NULL DEFAULT '',
    "country" TEXT,
    "city" TEXT,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_login_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_risk_flags_user_id_risk_type_status_idx" ON "user_risk_flags"("user_id", "risk_type", "status");

-- CreateIndex
CREATE INDEX "user_risk_flags_severity_status_idx" ON "user_risk_flags"("severity", "status");

-- CreateIndex
CREATE INDEX "user_risk_flags_risk_type_status_idx" ON "user_risk_flags"("risk_type", "status");

-- CreateIndex
CREATE INDEX "user_login_events_user_id_created_at_idx" ON "user_login_events"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "user_login_events_ip_address_idx" ON "user_login_events"("ip_address");
