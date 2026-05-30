-- AlterTable
ALTER TABLE "auth_users" ADD COLUMN IF NOT EXISTS "admin_role" TEXT;
