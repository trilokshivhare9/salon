import { PrismaClient, AdminRole, AdminStatus, SalonStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';

async function run() {
  const prisma = new PrismaClient();
  try {
    const passwordHash = await bcrypt.hash('Test@1234', 10);
    
    let superAdmin = await prisma.admin.findFirst({ where: { role: AdminRole.SUPER_ADMIN } });

    let salon = await prisma.salon.findFirst({ where: { slug: 'trilok-salon' } });
    if (!salon) {
      salon = await prisma.salon.create({
        data: {
          createdByAdminId: superAdmin?.id,
          name: 'Trilok Salon',
          slug: 'trilok-salon',
          phone: '+917999817743',
          email: 'dbtrilok@gmail.com',
          city: 'Indore',
          address: 'Indore, Madhya Pradesh',
          timezone: 'Asia/Kolkata',
          status: SalonStatus.ACTIVE,
          latitude: 22.6190,
          longitude: 76.0499,
          locationType: 'GPS',
        }
      });
    }

    let admin = await prisma.admin.findFirst({ where: { email: 'dbtrilok@gmail.com' } });
    if (!admin) {
      admin = await prisma.admin.create({
        data: {
          name: 'Trilok Shivhare',
          email: 'dbtrilok@gmail.com',
          phone: '+917999817743',
          passwordHash,
          role: AdminRole.SALON_OWNER,
          status: AdminStatus.ACTIVE,
          salonId: salon.id,
        }
      });
    } else {
      await prisma.admin.update({
        where: { id: admin.id },
        data: { phone: '+917999817743', passwordHash, salonId: salon.id, status: AdminStatus.ACTIVE }
      });
    }

    console.log('SUCCESS: Trilok Salon synced to local database!');
  } finally {
    await prisma.$disconnect();
  }
}

run();
