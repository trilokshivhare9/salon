import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🧹 Wiping all old test data to Clean Zero state...');

  // 1. Delete all records across all database tables
  await prisma.whatsAppLog.deleteMany();
  await prisma.whatsAppAccount.deleteMany();
  await prisma.appointmentStatusHistory.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.appointment.deleteMany();
  await prisma.blockedTime.deleteMany();
  await prisma.holiday.deleteMany();
  await prisma.staffBreak.deleteMany();
  await prisma.staffWorkingHours.deleteMany();
  await prisma.staffService.deleteMany();
  await prisma.service.deleteMany();
  await prisma.staff.deleteMany();
  await prisma.workingHours.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.subscription.deleteMany();
  await prisma.user.deleteMany();
  await prisma.salon.deleteMany();
  await prisma.plan.deleteMany();

  const passwordHash = await bcrypt.hash('Password123!', 10);

  // 2. Create Standard Subscription Plans
  await prisma.plan.create({
    data: {
      name: 'Trial',
      priceMonthly: 0,
      priceYearly: 0,
      maxStaff: 10,
      maxServices: 50,
      allowWhatsApp: true,
    },
  });

  await prisma.plan.create({
    data: {
      name: 'Pro',
      priceMonthly: 1999,
      priceYearly: 19999,
      maxStaff: 50,
      maxServices: 200,
      allowWhatsApp: true,
    },
  });

  // 3. Create Master Platform Super Admin Account
  await prisma.user.create({
    data: {
      name: 'Platform Super Admin',
      email: 'admin@salonsaas.com',
      passwordHash,
      role: UserRole.PLATFORM_ADMIN,
    },
  });

  console.log('✅ Database reset to Clean Zero successfully!');
  console.log('📊 Current State: 0 Salons, 0 Staff, 0 Services, 0 Bookings');
  console.log('🔑 Master Super Admin: admin@salonsaas.com / Password123!');
}

main()
  .catch((e) => {
    console.error('❌ Error during seed reset:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
