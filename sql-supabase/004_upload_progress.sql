-- ============================================================
-- Migration: Upload commit progress tracking
-- Run this once in Supabase SQL Editor (Project > SQL Editor > New query).
-- Safe to re-run — every statement below is idempotent.
-- ============================================================

-- Lets the client poll GET /api/uploads/:jobId during a commit and show
-- real progress (blobs created so far, current stage) instead of a
-- simulated curve — see bulkCommitService.commitFiles and
-- routes/uploads.js's onProgress wiring.
alter table upload_jobs add column if not exists progress_stage text;
alter table upload_jobs add column if not exists progress_completed integer not null default 0;
alter table upload_jobs add column if not exists progress_total integer not null default 0;
