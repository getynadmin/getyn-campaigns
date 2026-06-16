-- Track imported vs updated rows separately. The existing
-- successRows counter conflates both: an import of 10k contacts
-- where 8k already exist still reports "successRows: 10000" with
-- no signal that 8k were updates.
--
-- updatedRows defaults to 0 for historical rows so existing reads
-- don't change shape.

ALTER TABLE "ImportJob"
  ADD COLUMN "updatedRows" INTEGER NOT NULL DEFAULT 0;
