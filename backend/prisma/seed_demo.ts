import {
  PrismaClient,
  AdminRole,
  AdminStatus,
  SalonStatus,
  ServiceGender,
  ServiceStatus,
  StylistStatus,
  DayOfWeek,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting DB Seeding with WhatsApp configuration...');

  // 1. Clear existing data
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
  await prisma.serviceCategory.deleteMany();
  await prisma.salonWorkingHours.deleteMany();
  await prisma.user.deleteMany();
  await prisma.salon.deleteMany();
  await prisma.admin.deleteMany();

  const passwordHash = await bcrypt.hash('Password123!', 10);

  // 2. Create Super Admin
  const superAdmin = await prisma.admin.create({
    data: {
      name: 'Platform Super Admin',
      email: 'admin@salonsaas.com',
      passwordHash,
      role: AdminRole.SUPER_ADMIN,
      status: AdminStatus.ACTIVE,
    },
  });
  console.log(`✅ Super Admin created: ${superAdmin.email}`);

  // 3. Create Demo Salon
  const salon = await prisma.salon.create({
    data: {
      createdByAdminId: superAdmin.id,
      name: 'SalonFlow Luxury Salon',
      slug: 'luxury-salon',
      phone: '+919876543210',
      email: 'contact@luxurysalon.com',
      address: '123 Main Street',
      city: 'Mumbai',
      state: 'Maharashtra',
      country: 'IN',
      timezone: 'Asia/Kolkata',
      status: SalonStatus.ACTIVE,
      defaultStartTime: '09:00',
      defaultEndTime: '21:00',
      maxAdvanceDays: 30,
      cancelWindowHours: 2,
      allowSpecificStylist: true,
    },
  });
  console.log(`✅ Salon created: ${salon.name} (ID: ${salon.id})`);

  // 4. Create Salon Owner Admin
  const salonOwner = await prisma.admin.create({
    data: {
      name: 'Salon Owner',
      email: 'owner@luxurysalon.com',
      passwordHash,
      role: AdminRole.SALON_OWNER,
      status: AdminStatus.ACTIVE,
      salonId: salon.id,
    },
  });
  console.log(`✅ Salon Owner created: ${salonOwner.email}`);

  // 5. Create WhatsApp Account linked to Salon
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || '1344691785393273';
  const whatsappAccount = await prisma.whatsAppAccount.create({
    data: {
      salonId: salon.id,
      phoneNumberId: phoneNumberId,
      wabaId: '123456789',
      accessTokenEncrypted: 'system_managed',
      webhookVerifyToken: process.env.WHATSAPP_VERIFY_TOKEN || 'salon_webhook_verify_token_mvp',
      isActive: true,
    },
  });
  console.log(`✅ WhatsApp Account linked: PhoneId ${whatsappAccount.phoneNumberId}`);

  // 6. Create Service Categories & Services
  const haircutCategory = await prisma.serviceCategory.create({
    data: {
      salonId: salon.id,
      name: 'Hair Services',
      sortOrder: 1,
    },
  });

  const skinCategory = await prisma.serviceCategory.create({
    data: {
      salonId: salon.id,
      name: 'Skin Care',
      sortOrder: 2,
    },
  });

  const service1 = await prisma.service.create({
    data: {
      salonId: salon.id,
      categoryId: haircutCategory.id,
      name: "Men's Classic Haircut",
      description: 'Stylish precision haircut & styling',
      price: 350,
      durationMinutes: 30,
      targetGender: ServiceGender.MALE,
      status: ServiceStatus.ACTIVE,
    },
  });

  const service2 = await prisma.service.create({
    data: {
      salonId: salon.id,
      categoryId: haircutCategory.id,
      name: 'Beard Trim & Styling',
      description: 'Beard shaping with hot towel treatment',
      price: 200,
      durationMinutes: 20,
      targetGender: ServiceGender.MALE,
      status: ServiceStatus.ACTIVE,
    },
  });

  const service3 = await prisma.service.create({
    data: {
      salonId: salon.id,
      categoryId: skinCategory.id,
      name: 'Deep Cleansing Facial',
      description: 'Refreshing facial for glowing skin',
      price: 800,
      durationMinutes: 45,
      targetGender: ServiceGender.UNISEX,
      status: ServiceStatus.ACTIVE,
    },
  });

  console.log('✅ Services created: Haircut, Beard Trim, Facial');

  // 7. Create Stylists
  const stylist1 = await prisma.stylist.create({
    data: {
      salonId: salon.id,
      name: 'Alex Johnson',
      phone: '+919999911111',
      status: StylistStatus.ACTIVE,
    },
  });

  const stylist2 = await prisma.stylist.create({
    data: {
      salonId: salon.id,
      name: 'Priya Sharma',
      phone: '+919999922222',
      status: StylistStatus.ACTIVE,
    },
  });

  // Link services to stylists
  await prisma.stylistService.createMany({
    data: [
      { salonId: salon.id, stylistId: stylist1.id, serviceId: service1.id },
      { salonId: salon.id, stylistId: stylist1.id, serviceId: service2.id },
      { salonId: salon.id, stylistId: stylist2.id, serviceId: service1.id },
      { salonId: salon.id, stylistId: stylist2.id, serviceId: service3.id },
    ],
  });

  // Set working hours for stylists & salon (Mon-Sun 09:00 - 21:00)
  const days: DayOfWeek[] = [
    DayOfWeek.MONDAY,
    DayOfWeek.TUESDAY,
    DayOfWeek.WEDNESDAY,
    DayOfWeek.THURSDAY,
    DayOfWeek.FRIDAY,
    DayOfWeek.SATURDAY,
    DayOfWeek.SUNDAY,
  ];

  for (const day of days) {
    await prisma.stylistWorkingHours.createMany({
      data: [
        { stylistId: stylist1.id, dayOfWeek: day, startTime: '09:00', endTime: '21:00', isWorking: true },
        { stylistId: stylist2.id, dayOfWeek: day, startTime: '09:00', endTime: '21:00', isWorking: true },
      ],
    });
    await prisma.salonWorkingHours.create({
      data: { salonId: salon.id, dayOfWeek: day, startTime: '09:00', endTime: '21:00', isClosed: false },
    });
  }

  console.log('✅ Stylists & Working Hours configured!');
  console.log('🚀 Seed completed successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
