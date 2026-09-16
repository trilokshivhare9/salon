-- AlterTable
ALTER TABLE "salon_working_hours" ADD COLUMN "breaks" JSONB DEFAULT '[]';

-- AlterTable
ALTER TABLE "stylist_working_hours" ADD COLUMN "has_break_override" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "breaks" JSONB DEFAULT '[]';

-- Data Migration: Migrate existing legacy breakStartTime/breakEndTime into the breaks JSONB array
UPDATE "salon_working_hours"
SET "breaks" = jsonb_build_array(
  jsonb_build_object(
    'id', gen_random_uuid()::text,
    'startTime', "break_start_time",
    'endTime', "break_end_time",
    'title', 'Lunch Break'
  )
)
WHERE "break_start_time" IS NOT NULL 
  AND "break_end_time" IS NOT NULL
  AND ("breaks" IS NULL OR "breaks" = '[]'::jsonb);

UPDATE "stylist_working_hours"
SET "breaks" = jsonb_build_array(
  jsonb_build_object(
    'id', gen_random_uuid()::text,
    'startTime', "break_start_time",
    'endTime', "break_end_time",
    'title', 'Lunch Break'
  )
),
"has_break_override" = true
WHERE "break_start_time" IS NOT NULL 
  AND "break_end_time" IS NOT NULL
  AND ("breaks" IS NULL OR "breaks" = '[]'::jsonb);
