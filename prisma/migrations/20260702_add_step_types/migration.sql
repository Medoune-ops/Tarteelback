-- Add ordering and matching to StepType enum.
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction, so this migration
-- intentionally has no wrapping BEGIN/COMMIT (Prisma handles it via --no-lock).
ALTER TYPE "StepType" ADD VALUE IF NOT EXISTS 'ordering';
ALTER TYPE "StepType" ADD VALUE IF NOT EXISTS 'matching';
