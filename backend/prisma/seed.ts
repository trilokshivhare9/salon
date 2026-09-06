import { PrismaClient, AdminRole, AdminStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🧹 Wiping all old test data to Clean Zero state...');

  // 1. Delete all records across all database tables
  await prisma.auditLog.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.whatsAppLog.deleteMany();
  await prisma.whatsAppAccount.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.appointment.deleteMany();
  await prisma.salonUser.deleteMany();
  await prisma.stylistWorkingHours.deleteMany();
  await prisma.stylistService.deleteMany();
  await prisma.stylist.deleteMany();
  await prisma.service.deleteMany();
  await prisma.salonWorkingHours.deleteMany();
  await prisma.user.deleteMany();
  await prisma.salon.deleteMany();
  await prisma.admin.deleteMany();

  const passwordHash = await bcrypt.hash('Password123!', 10);

  // 2. Create Master Platform Super Admin Account
  const superAdmin = await prisma.admin.create({
    data: {
      name: 'Platform Super Admin',
      email: 'admin@salonsaas.com',
      passwordHash,
      role: AdminRole.SUPER_ADMIN,
      status: AdminStatus.ACTIVE,
    },
  });

  console.log('✅ Database reset to Clean Zero successfully!');
  console.log(`🔑 Master Super Admin Created: admin@salonsaas.com / Password123! (ID: ${superAdmin.id})`);
}

main()
  .catch((e) => {
    console.error('❌ Error during seed reset:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
