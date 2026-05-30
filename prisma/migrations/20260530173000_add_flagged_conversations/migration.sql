-- CreateTable
CREATE TABLE IF NOT EXISTS "flagged_conversations" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "flag_type" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "flagged_by" TEXT NOT NULL,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "flagged_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "flagged_conversations_user_id_idx" ON "flagged_conversations"("user_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "flagged_conversations_flag_type_resolved_idx" ON "flagged_conversations"("flag_type", "resolved");
