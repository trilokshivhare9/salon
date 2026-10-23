import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION trg_fn_prevent_admin_phone_mutation()
    RETURNS TRIGGER AS $$
    BEGIN
      IF OLD.phone IS NOT NULL AND NEW.phone IS DISTINCT FROM OLD.phone THEN
        IF current_setting('app.allow_system_phone_update', true) = 'true' THEN
          RETURN NEW;
        END IF;

        RAISE EXCEPTION 'CRITICAL SECURITY VIOLATION: Admin mobile number (%) is immutable and cannot be modified!', OLD.phone
          USING ERRCODE = 'check_violation';
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await prisma.$executeRawUnsafe(`
    DROP TRIGGER IF EXISTS trg_lock_admin_phone ON admins;
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER trg_lock_admin_phone
    BEFORE UPDATE OF phone ON admins
    FOR EACH ROW
    EXECUTE FUNCTION trg_fn_prevent_admin_phone_mutation();
  `);

  console.log('✅ PostgreSQL trigger trg_lock_admin_phone successfully installed on admins table!');
}

main()
  .catch((e) => {
    console.error('Failed to install trigger:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
