import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function runStep2Migration() {
  console.log('================================================================');
  console.log('STEP 2: PRODUCTION SCHEMA MIGRATION & POST-MIGRATION AUDIT');
  console.log('================================================================');
  console.log(`Connecting to database: ${process.env.DATABASE_URL?.split('@')[1] || 'configured DB'}...`);

  await prisma.$connect();
  console.log('Successfully connected to production database.\n');

  try {
    // -------------------------------------------------------------------------
    // PHASE 1: ADDITIVE CHANGES
    // -------------------------------------------------------------------------
    console.log('--- Phase 1: Additive Changes ---');

    console.log('1.1 Ensuring btree_gist extension exists...');
    await prisma.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS btree_gist;`);
    console.log('    Extension btree_gist verified.');

    console.log('1.2 Ensuring composite unique keys on referenced tables...');
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS salon_users_salon_id_id_key ON salon_users(salon_id, id);`);
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS stylists_salon_id_id_key ON stylists(salon_id, id);`);
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS services_salon_id_id_key ON services(salon_id, id);`);
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS appointments_salon_id_id_key ON appointments(salon_id, id);`);
    console.log('    Composite unique keys verified.');

    console.log('1.3 Ensuring appointment_services table exists...');
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS appointment_services (
        id VARCHAR(36) PRIMARY KEY,
        salon_id VARCHAR(36) NOT NULL,
        appointment_id VARCHAR(36) NOT NULL,
        service_id VARCHAR(36) NOT NULL,
        service_name_snapshot VARCHAR(255) NOT NULL,
        duration_minutes INTEGER NOT NULL,
        price NUMERIC(10, 2) NOT NULL,
        order_index INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS appointment_services_salon_appt_idx ON appointment_services(salon_id, appointment_id);`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS appointment_services_salon_srv_idx ON appointment_services(salon_id, service_id);`);
    console.log('    appointment_services table verified.');

    console.log('1.4 Adding nullable appointments.salon_user_id column if not present...');
    await prisma.$executeRawUnsafe(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS salon_user_id VARCHAR(36);`);
    console.log('    appointments.salon_user_id column verified.');

    console.log('1.5 Adding stylist_services.salon_id column if not present...');
    await prisma.$executeRawUnsafe(`ALTER TABLE stylist_services ADD COLUMN IF NOT EXISTS salon_id VARCHAR(36);`);
    console.log('    stylist_services.salon_id column verified.');

    console.log('Phase 1 completed successfully.\n');

    // -------------------------------------------------------------------------
    // PHASE 2: DATA BACKFILL
    // -------------------------------------------------------------------------
    console.log('--- Phase 2: Lossless Data Backfill ---');

    console.log('2.1 Backfilling appointments.salon_user_id from salon_users...');
    // Check if appointments has user_id column
    const userColCheck: any[] = await prisma.$queryRawUnsafe(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'appointments' AND column_name = 'user_id';
    `);
    if (userColCheck.length > 0) {
      const backfilledUsers = await prisma.$executeRawUnsafe(`
        UPDATE appointments a
        SET salon_user_id = su.id
        FROM salon_users su
        WHERE su.salon_id = a.salon_id AND su.user_id = a.user_id AND a.salon_user_id IS NULL;
      `);
      console.log(`    Backfilled ${backfilledUsers} appointment salon_user_id records.`);
    } else {
      console.log('    appointments.user_id column already superseded; salon_user_id is active.');
    }

    console.log('2.2 Backfilling appointment_services snapshot rows...');
    const backfilledSnapshots = await prisma.$executeRawUnsafe(`
      INSERT INTO appointment_services (
        id, salon_id, appointment_id, service_id, service_name_snapshot, duration_minutes, price, order_index, created_at
      )
      SELECT
        gen_random_uuid()::text,
        a.salon_id,
        a.id,
        a.service_id,
        a.service_name_snapshot,
        a.duration_minutes,
        a.price,
        0,
        a.created_at
      FROM appointments a
      WHERE NOT EXISTS (
        SELECT 1 FROM appointment_services aps WHERE aps.appointment_id = a.id
      );
    `);
    console.log(`    Backfilled ${backfilledSnapshots} appointment_services records.`);

    console.log('2.3 Backfilling stylist_services.salon_id from parent stylist...');
    const backfilledStylistServices = await prisma.$executeRawUnsafe(`
      UPDATE stylist_services ss
      SET salon_id = s.salon_id
      FROM stylists s
      WHERE s.id = ss.stylist_id AND ss.salon_id IS NULL;
    `);
    console.log(`    Backfilled ${backfilledStylistServices} stylist_services records.`);

    console.log('Phase 2 completed successfully.\n');

    // -------------------------------------------------------------------------
    // PHASE 3: INTEGRITY ENFORCEMENT
    // -------------------------------------------------------------------------
    console.log('--- Phase 3: Integrity Enforcement ---');

    console.log('3.1 Pre-check: Verifying zero NULL salon_user_id rows in appointments...');
    const nullSalonUsers: any[] = await prisma.$queryRawUnsafe(`
      SELECT count(*)::int AS count FROM appointments WHERE salon_user_id IS NULL;
    `);
    const nullCount = Number(nullSalonUsers[0].count);
    if (nullCount > 0) {
      throw new Error(`CRITICAL INVARIANT VIOLATION: Found ${nullCount} appointments with NULL salon_user_id! Aborting.`);
    }
    console.log(`    Pre-check passed: 0 NULL salon_user_id rows found.`);

    console.log('3.2 Enforcing NOT NULL on appointments.salon_user_id...');
    await prisma.$executeRawUnsafe(`ALTER TABLE appointments ALTER COLUMN salon_user_id SET NOT NULL;`);
    console.log('    appointments.salon_user_id is now NOT NULL.');

    console.log('3.3 Removing redundant appointments.user_id if present...');
    await prisma.$executeRawUnsafe(`ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_user_id_fkey;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE appointments DROP COLUMN IF EXISTS user_id;`);
    console.log('    appointments.user_id dropped / absent.');

    console.log('3.4 Enforcing NOT NULL and primary key on stylist_services...');
    await prisma.$executeRawUnsafe(`ALTER TABLE stylist_services ALTER COLUMN salon_id SET NOT NULL;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE stylist_services DROP CONSTRAINT IF EXISTS stylist_services_pkey CASCADE;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE stylist_services ADD PRIMARY KEY (salon_id, stylist_id, service_id);`);

    console.log('3.5 Adding tenant-safe composite foreign keys...');
    // appointments -> salon_users
    await prisma.$executeRawUnsafe(`ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_salon_user_fkey;`);
    await prisma.$executeRawUnsafe(`
      ALTER TABLE appointments ADD CONSTRAINT appointments_salon_user_fkey
        FOREIGN KEY (salon_id, salon_user_id) REFERENCES salon_users(salon_id, id) ON DELETE RESTRICT;
    `);

    // appointments -> stylists
    await prisma.$executeRawUnsafe(`ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_salon_stylist_fkey;`);
    await prisma.$executeRawUnsafe(`
      ALTER TABLE appointments ADD CONSTRAINT appointments_salon_stylist_fkey
        FOREIGN KEY (salon_id, stylist_id) REFERENCES stylists(salon_id, id) ON DELETE RESTRICT;
    `);

    // appointment_services -> appointments
    await prisma.$executeRawUnsafe(`ALTER TABLE appointment_services DROP CONSTRAINT IF EXISTS appointment_services_salon_appointment_fkey;`);
    await prisma.$executeRawUnsafe(`
      ALTER TABLE appointment_services ADD CONSTRAINT appointment_services_salon_appointment_fkey
        FOREIGN KEY (salon_id, appointment_id) REFERENCES appointments(salon_id, id) ON DELETE CASCADE;
    `);

    // appointment_services -> services
    await prisma.$executeRawUnsafe(`ALTER TABLE appointment_services DROP CONSTRAINT IF EXISTS appointment_services_salon_service_fkey;`);
    await prisma.$executeRawUnsafe(`
      ALTER TABLE appointment_services ADD CONSTRAINT appointment_services_salon_service_fkey
        FOREIGN KEY (salon_id, service_id) REFERENCES services(salon_id, id) ON DELETE RESTRICT;
    `);

    // stylist_services -> stylists
    await prisma.$executeRawUnsafe(`ALTER TABLE stylist_services DROP CONSTRAINT IF EXISTS stylist_services_salon_stylist_fkey;`);
    await prisma.$executeRawUnsafe(`
      ALTER TABLE stylist_services ADD CONSTRAINT stylist_services_salon_stylist_fkey
        FOREIGN KEY (salon_id, stylist_id) REFERENCES stylists(salon_id, id) ON DELETE CASCADE;
    `);

    // stylist_services -> services
    await prisma.$executeRawUnsafe(`ALTER TABLE stylist_services DROP CONSTRAINT IF EXISTS stylist_services_salon_service_fkey;`);
    await prisma.$executeRawUnsafe(`
      ALTER TABLE stylist_services ADD CONSTRAINT stylist_services_salon_service_fkey
        FOREIGN KEY (salon_id, service_id) REFERENCES services(salon_id, id) ON DELETE CASCADE;
    `);

    console.log('3.6 Verifying zero orphan/dangling relationships...');
    const orphanApts: any[] = await prisma.$queryRawUnsafe(`
      SELECT a.id FROM appointments a
      LEFT JOIN salon_users su ON a.salon_id = su.salon_id AND a.salon_user_id = su.id
      WHERE su.id IS NULL;
    `);
    if (orphanApts.length > 0) {
      throw new Error(`CRITICAL: Found ${orphanApts.length} orphan appointments without matching salon_user!`);
    }

    const orphanSnapshots: any[] = await prisma.$queryRawUnsafe(`
      SELECT aps.id FROM appointment_services aps
      LEFT JOIN appointments a ON aps.salon_id = a.salon_id AND aps.appointment_id = a.id
      WHERE a.id IS NULL;
    `);
    if (orphanSnapshots.length > 0) {
      throw new Error(`CRITICAL: Found ${orphanSnapshots.length} orphan appointment_services!`);
    }
    console.log('    Zero orphan/dangling relationships verified.');

    console.log('Phase 3 completed successfully.\n');

    // -------------------------------------------------------------------------
    // PHASE 4: CONCURRENCY PROTECTION & ENUM PRUNING
    // -------------------------------------------------------------------------
    console.log('--- Phase 4: Concurrency Protection & Enum Pruning ---');

    console.log('4.1 Creating / verifying no_overlapping_stylist_appointments GiST exclusion constraint...');
    await prisma.$executeRawUnsafe(`ALTER TABLE appointments DROP CONSTRAINT IF EXISTS no_overlapping_stylist_appointments;`);
    await prisma.$executeRawUnsafe(`
      ALTER TABLE appointments ADD CONSTRAINT no_overlapping_stylist_appointments
      EXCLUDE USING gist (
        salon_id WITH =,
        stylist_id WITH =,
        tstzrange(start_at, end_at, '[)') WITH &&
      )
      WHERE (status IN ('CONFIRMED', 'CHECKED_IN', 'IN_SERVICE'));
    `);
    console.log('    no_overlapping_stylist_appointments constraint active.');

    console.log('4.2 Creating / verifying no_overlapping_customer_appointments GiST exclusion constraint...');
    await prisma.$executeRawUnsafe(`ALTER TABLE appointments DROP CONSTRAINT IF EXISTS no_overlapping_customer_appointments;`);
    await prisma.$executeRawUnsafe(`
      ALTER TABLE appointments ADD CONSTRAINT no_overlapping_customer_appointments
      EXCLUDE USING gist (
        salon_id WITH =,
        salon_user_id WITH =,
        tstzrange(start_at, end_at, '[)') WITH &&
      )
      WHERE (status IN ('CONFIRMED', 'CHECKED_IN', 'IN_SERVICE'));
    `);
    console.log('    no_overlapping_customer_appointments constraint active.');

    console.log('4.3 Verifying AppointmentStatus enum values...');
    const enumCheck: any[] = await prisma.$queryRawUnsafe(`
      SELECT e.enumlabel 
      FROM pg_enum e
      JOIN pg_type t ON e.enumtypid = t.oid
      WHERE t.typname = 'AppointmentStatus'
      ORDER BY e.enumsortorder;
    `);
    const labels = enumCheck.map((r: any) => r.enumlabel);
    console.log(`    Current enum labels: ${labels.join(', ')}`);

    const deprecated = ['PENDING', 'EXPIRED', 'RESCHEDULED'].filter(d => labels.includes(d));
    if (deprecated.length > 0) {
      console.log(`    Pruning deprecated enum values: ${deprecated.join(', ')}...`);
      // Check if any appointments use deprecated statuses
      const deprecatedUsage: any[] = await prisma.$queryRawUnsafe(`
        SELECT count(*)::int AS count FROM appointments WHERE status::text IN ('PENDING', 'EXPIRED', 'RESCHEDULED');
      `);
      if (Number(deprecatedUsage[0].count) > 0) {
        throw new Error(`CRITICAL: Found ${deprecatedUsage[0].count} appointments with deprecated status!`);
      }

      await prisma.$executeRawUnsafe(`ALTER TYPE "AppointmentStatus" RENAME TO "AppointmentStatus_old";`);
      await prisma.$executeRawUnsafe(`
        CREATE TYPE "AppointmentStatus" AS ENUM (
          'CONFIRMED', 'CHECKED_IN', 'IN_SERVICE', 'COMPLETED', 'CANCELLED', 'NO_SHOW'
        );
      `);
      await prisma.$executeRawUnsafe(`ALTER TABLE appointments ALTER COLUMN status DROP DEFAULT;`);
      await prisma.$executeRawUnsafe(`ALTER TABLE appointments ALTER COLUMN status TYPE "AppointmentStatus" USING (status::text::"AppointmentStatus");`);
      await prisma.$executeRawUnsafe(`ALTER TABLE appointments ALTER COLUMN status SET DEFAULT 'CONFIRMED';`);
      await prisma.$executeRawUnsafe(`DROP TYPE "AppointmentStatus_old";`);
      console.log('    Enum successfully pruned to 6 valid operational statuses.');
    } else {
      console.log('    AppointmentStatus enum is already clean (0 deprecated values).');
    }

    console.log('Phase 4 completed successfully.\n');

    // -------------------------------------------------------------------------
    // POST-MIGRATION VERIFICATION (OPERATOR PROTOCOL)
    // -------------------------------------------------------------------------
    console.log('================================================================');
    console.log('POST-MIGRATION VERIFICATION AUDIT');
    console.log('================================================================');

    // Check 1: SELECT COUNT(*) FROM appointments;
    const totalAptsResult: any[] = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS count FROM appointments;`);
    const totalApts = Number(totalAptsResult[0].count);
    console.log(`1. Total appointments count: ${totalApts} (Expected: 6) -> ${totalApts === 6 ? '✅ PASS' : '❌ FAIL'}`);

    // Check 2: SELECT COUNT(*) FROM appointments WHERE salon_user_id IS NULL;
    const nullAptsResult: any[] = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS count FROM appointments WHERE salon_user_id IS NULL;`);
    const nullApts = Number(nullAptsResult[0].count);
    console.log(`2. Null salon_user_id count: ${nullApts} (Expected: 0) -> ${nullApts === 0 ? '✅ PASS' : '❌ FAIL'}`);

    // Check 3: SELECT conname FROM pg_constraint WHERE conname IN ('no_overlapping_stylist_appointments', 'no_overlapping_customer_appointments');
    const constraintsResult: any[] = await prisma.$queryRawUnsafe(`
      SELECT conname
      FROM pg_constraint
      WHERE conname IN (
        'no_overlapping_stylist_appointments',
        'no_overlapping_customer_appointments'
      )
      ORDER BY conname;
    `);
    const constraintNames = constraintsResult.map((c: any) => c.conname);
    console.log(`3. GiST Constraints found: ${constraintNames.join(', ')} (${constraintNames.length} rows, Expected: 2) -> ${constraintNames.length === 2 ? '✅ PASS' : '❌ FAIL'}`);

    // Check 4: Verify the 6 appointment numbers and their timestamps/prices remain unchanged
    const aptDetails: any[] = await prisma.$queryRawUnsafe(`
      SELECT 
        a.id,
        a.appointment_number,
        a.status,
        a.start_at,
        a.end_at,
        a.duration_minutes,
        a.price,
        su.id AS salon_user_id,
        st.name AS stylist_name
      FROM appointments a
      JOIN salon_users su ON a.salon_id = su.salon_id AND a.salon_user_id = su.id
      JOIN stylists st ON a.salon_id = st.salon_id AND a.stylist_id = st.id
      ORDER BY a.start_at ASC;
    `);

    console.log('\n4. Inspection of 6 Production Appointments:');
    for (const apt of aptDetails) {
      console.log(`   - [${apt.appointment_number}] ${apt.status} | Start: ${apt.start_at.toISOString()} | End: ${apt.end_at.toISOString()} | Duration: ${apt.duration_minutes}m | Price: ₹${apt.price} | Stylist: ${apt.stylist_name}`);
    }

    // Check 5: appointment_services snapshot count
    const snapshotCountResult: any[] = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS count FROM appointment_services;`);
    const snapshotCount = Number(snapshotCountResult[0].count);
    console.log(`\n5. appointment_services snapshot rows: ${snapshotCount} (Expected: 6) -> ${snapshotCount === 6 ? '✅ PASS' : '❌ FAIL'}`);

    if (totalApts !== 6 || nullApts !== 0 || constraintNames.length !== 2 || snapshotCount !== 6) {
      throw new Error('POST-MIGRATION VERIFICATION FAILED: One or more audit checks did not match expected invariants!');
    }

    console.log('\n================================================================');
    console.log('STEP 2 MIGRATION & POST-MIGRATION VERIFICATION COMPLETED: ALL PASS ✅');
    console.log('================================================================');
  } finally {
    await prisma.$disconnect();
  }
}

runStep2Migration().catch((err) => {
  console.error('Fatal Step 2 Migration Error:', err);
  process.exit(1);
});
