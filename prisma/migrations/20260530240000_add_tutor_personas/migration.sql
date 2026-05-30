CREATE TABLE "tutor_personas" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "avatar_url" TEXT NOT NULL DEFAULT '',
    "expertise_tags" JSONB NOT NULL DEFAULT '[]',
    "voice_model" TEXT NOT NULL DEFAULT '',
    "voice_badge" TEXT NOT NULL DEFAULT '',
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "behavior_settings" JSONB NOT NULL DEFAULT '{}',
    "current_prompt_version_id" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tutor_personas_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "tutor_personas_slug_key" ON "tutor_personas"("slug");
CREATE INDEX "tutor_personas_is_published_idx" ON "tutor_personas"("is_published");

CREATE TABLE "tutor_prompt_versions" (
    "id" TEXT NOT NULL,
    "persona_id" TEXT NOT NULL,
    "version_number" INTEGER NOT NULL,
    "system_prompt" TEXT NOT NULL,
    "change_note" TEXT NOT NULL DEFAULT '',
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tutor_prompt_versions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "tutor_prompt_versions_persona_id_version_number_key" ON "tutor_prompt_versions"("persona_id", "version_number");
CREATE INDEX "tutor_prompt_versions_persona_id_created_at_idx" ON "tutor_prompt_versions"("persona_id", "created_at" DESC);
ALTER TABLE "tutor_prompt_versions" ADD CONSTRAINT "tutor_prompt_versions_persona_id_fkey" FOREIGN KEY ("persona_id") REFERENCES "tutor_personas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
