const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  console.log('--- Step 1: Add "days" column if not present ---');
  await prisma.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'salon_breaks' AND column_name = 'days'
      ) THEN
        ALTER TABLE "salon_breaks" ADD COLUMN "days" "DayOfWeek"[] DEFAULT '{}';
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'stylist_breaks' AND column_name = 'days'
      ) THEN
        ALTER TABLE "stylist_breaks" ADD COLUMN "days" "DayOfWeek"[] DEFAULT '{}';
      END IF;
    END $$;
  `);

  console.log('--- Step 2: Consolidate salon_breaks ---');
  // Find all groups of salon_breaks
  const salonGroups = await prisma.$queryRawUnsafe(`
    SELECT salon_id, title, start_time, end_time, array_agg(DISTINCT day_of_week) as days_list, array_agg(id ORDER BY created_at ASC) as id_list
    FROM salon_breaks
    WHERE day_of_week IS NOT NULL
    GROUP BY salon_id, title, start_time, end_time
  `);

  const salonBreakIdMap = {}; // old_id -> new_canonical_id

  for (const g of salonGroups) {
    const canonicalId = g.id_list[0];
    const duplicateIds = g.id_list.slice(1);

    for (const oldId of g.id_list) {
      salonBreakIdMap[oldId] = canonicalId;
    }

    // Update canonical row with full days array
    await prisma.$executeRawUnsafe(`
      UPDATE salon_breaks 
      SET days = $1::"DayOfWeek"[]
      WHERE id = $2
    `, g.days_list, canonicalId);

    // If there were duplicates, update references in stylist_breaks before deleting duplicates
    if (duplicateIds.length > 0) {
      for (const dupId of duplicateIds) {
        await prisma.$executeRawUnsafe(`
          UPDATE stylist_breaks 
          SET salon_break_id = $1 
          WHERE salon_break_id = $2
        `, canonicalId, dupId);
      }
      await prisma.$executeRawUnsafe(`
        DELETE FROM salon_breaks 
        WHERE id = ANY($1::text[])
      `, duplicateIds);
    }
    console.log(`Consolidated salon break "${g.title}" (${g.start_time}-${g.end_time}) -> ID ${canonicalId} with days:`, g.days_list);
  }

  console.log('--- Step 3: Consolidate stylist_breaks ---');
  const stylistGroups = await prisma.$queryRawUnsafe(`
    SELECT salon_id, stylist_id, title, start_time, end_time, is_customized, salon_break_id,
           array_agg(DISTINCT day_of_week) as days_list, array_agg(id ORDER BY created_at ASC) as id_list
    FROM stylist_breaks
    WHERE day_of_week IS NOT NULL
    GROUP BY salon_id, stylist_id, title, start_time, end_time, is_customized, salon_break_id
  `);

  for (const g of stylistGroups) {
    const canonicalId = g.id_list[0];
    const duplicateIds = g.id_list.slice(1);

    const remappedParentId = g.salon_break_id ? (salonBreakIdMap[g.salon_break_id] || g.salon_break_id) : null;

    await prisma.$executeRawUnsafe(`
      UPDATE stylist_breaks 
      SET days = $1::"DayOfWeek"[], salon_break_id = $2
      WHERE id = $3
    `, g.days_list, remappedParentId, canonicalId);

    if (duplicateIds.length > 0) {
      await prisma.$executeRawUnsafe(`
        DELETE FROM stylist_breaks 
        WHERE id = ANY($1::text[])
      `, duplicateIds);
    }
    console.log(`Consolidated stylist break for ${g.stylist_id}: "${g.title}" (${g.start_time}-${g.end_time}) -> ID ${canonicalId} with days:`, g.days_list);
  }

  console.log('--- Step 4: Drop old unique constraints and day_of_week column ---');
  await prisma.$executeRawUnsafe(`
    DO $$
    BEGIN
      -- Drop old unique constraint on salon_breaks if it exists
      IF EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'salon_breaks_salon_id_day_of_week_start_time_end_time_key'
      ) THEN
        ALTER TABLE "salon_breaks" DROP CONSTRAINT "salon_breaks_salon_id_day_of_week_start_time_end_time_key";
      END IF;

      -- Drop old index on stylist_breaks if it exists
      IF EXISTS (
        SELECT 1 FROM pg_indexes WHERE indexname = 'stylist_breaks_salon_id_stylist_id_day_of_week_idx'
      ) THEN
        DROP INDEX "stylist_breaks_salon_id_stylist_id_day_of_week_idx";
      END IF;

      -- Drop day_of_week column
      IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'salon_breaks' AND column_name = 'day_of_week'
      ) THEN
        ALTER TABLE "salon_breaks" DROP COLUMN "day_of_week";
      END IF;

      IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'stylist_breaks' AND column_name = 'day_of_week'
      ) THEN
        ALTER TABLE "stylist_breaks" DROP COLUMN "day_of_week";
      END IF;

      -- Create new composite index on stylist_breaks
      IF NOT EXISTS (
        SELECT 1 FROM pg_indexes WHERE indexname = 'stylist_breaks_salon_id_stylist_id_idx'
      ) THEN
        CREATE INDEX "stylist_breaks_salon_id_stylist_id_idx" ON "stylist_breaks"("salon_id", "stylist_id");
      END IF;
    END $$;
  `);

  console.log('--- Migration completed successfully! ---');
}

run()
  .catch((e) => {
    console.error('Migration failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
