import { PrismaClient, UserRole, AppointmentStatus, BookingSource, DayOfWeek } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { DateTime } from 'luxon';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seed...');

  // 1. Clean existing records (if any)
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
  await prisma.plan.deleteMany();
  await prisma.user.deleteMany();
  await prisma.salon.deleteMany();

  const passwordHash = await bcrypt.hash('Password123!', 10);

  // 2. Create Plans
  const trialPlan = await prisma.plan.create({
    data: {
      name: 'Trial',
      priceMonthly: 0,
      priceYearly: 0,
      maxStaff: 10,
      maxServices: 50,
      allowWhatsApp: true,
    },
  });

  const proPlan = await prisma.plan.create({
    data: {
      name: 'Pro',
      priceMonthly: 1999,
      priceYearly: 19999,
      maxStaff: 50,
      maxServices: 200,
      allowWhatsApp: true,
    },
  });

  // 3. Create Platform Admin
  await prisma.user.create({
    data: {
      name: 'Platform Superadmin',
      email: 'admin@salonsaas.com',
      passwordHash,
      role: UserRole.PLATFORM_ADMIN,
    },
  });

  // 4. Create Pilot Salon: Glamour Studio
  const salon = await prisma.salon.create({
    data: {
      name: 'Glamour Studio & Lounge',
      slug: 'glamour-studio',
      phone: '+919876543210',
      email: 'owner@glamourstudio.com',
      address: '104 Indiranagar 100ft Road',
      city: 'Bengaluru',
      state: 'Karnataka',
      country: 'IN',
      timezone: 'Asia/Kolkata',
      description: 'Luxury hair styling, organic facials, and beauty lounge.',
      slotIntervalMinutes: 30,
      minAdvanceNoticeMins: 30,
      maxAdvanceDays: 30,
      cancelWindowHours: 2,
    },
  });

  // 5. Subscription
  const trialEnd = new Date();
  trialEnd.setDate(trialEnd.getDate() + 30);
  await prisma.subscription.create({
    data: {
      salonId: salon.id,
      planId: proPlan.id,
      status: 'ACTIVE',
      trialStartDate: new Date(),
      trialEndDate: trialEnd,
    },
  });

  // 6. Salon Admin User
  const salonAdmin = await prisma.user.create({
    data: {
      salonId: salon.id,
      name: 'Pooja Verma',
      email: 'owner@glamourstudio.com',
      phone: '+919876543210',
      passwordHash,
      role: UserRole.SALON_ADMIN,
    },
  });

  // 7. Salon Working Hours (Mon - Sun: 10:00 - 20:00)
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
    await prisma.workingHours.create({
      data: {
        salonId: salon.id,
        dayOfWeek: day,
        isOpen: true,
        openTime: '10:00',
        closeTime: '20:00',
      },
    });
  }

  // 8. Services Catalog
  const svcHaircut = await prisma.service.create({
    data: {
      salonId: salon.id,
      name: 'Haircut & Styling',
      description: 'Precision cut, wash, and blowdry style.',
      price: 500.0,
      durationMinutes: 30,
      category: 'Hair',
    },
  });

  const svcHairSpa = await prisma.service.create({
    data: {
      salonId: salon.id,
      name: 'Deep Nourishing Hair Spa',
      description: 'Intense hydration therapy with steam and scalp massage.',
      price: 1200.0,
      durationMinutes: 60,
      category: 'Hair',
    },
  });

  const svcFacial = await prisma.service.create({
    data: {
      salonId: salon.id,
      name: 'Glow Radiance Facial',
      description: 'Deep pore cleansing, exfoliation, and vitamin C mask.',
      price: 1500.0,
      durationMinutes: 60,
      category: 'Skin',
    },
  });

  const svcColor = await prisma.service.create({
    data: {
      salonId: salon.id,
      name: 'Global Hair Coloring',
      description: 'Premium ammonia-free color transformation.',
      price: 2500.0,
      durationMinutes: 90,
      category: 'Color',
    },
  });

  // 9. Staff Members
  const staffRahul = await prisma.staff.create({
    data: {
      salonId: salon.id,
      name: 'Rahul Mehta',
      phone: '+919811122233',
      email: 'rahul@glamourstudio.com',
      profileImageUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150',
    },
  });

  const staffPriya = await prisma.staff.create({
    data: {
      salonId: salon.id,
      name: 'Priya Sharma',
      phone: '+919844455566',
      email: 'priya@glamourstudio.com',
      profileImageUrl: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150',
    },
  });

  const staffAmit = await prisma.staff.create({
    data: {
      salonId: salon.id,
      name: 'Amit Patel',
      phone: '+919877788899',
      email: 'amit@glamourstudio.com',
      profileImageUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150',
    },
  });

  // 10. Staff-Service Capability Assignments
  // Rahul: Haircut, Hair Spa
  await prisma.staffService.createMany({
    data: [
      { staffId: staffRahul.id, serviceId: svcHaircut.id },
      { staffId: staffRahul.id, serviceId: svcHairSpa.id },
    ],
  });

  // Priya: Haircut, Facial, Hair Color
  await prisma.staffService.createMany({
    data: [
      { staffId: staffPriya.id, serviceId: svcHaircut.id },
      { staffId: staffPriya.id, serviceId: svcFacial.id },
      { staffId: staffPriya.id, serviceId: svcColor.id },
    ],
  });

  // Amit: Haircut, Hair Spa
  await prisma.staffService.createMany({
    data: [
      { staffId: staffAmit.id, serviceId: svcHaircut.id },
      { staffId: staffAmit.id, serviceId: svcHairSpa.id },
    ],
  });

  // 11. Staff Working Hours & Breaks
  const allStaff = [staffRahul, staffPriya, staffAmit];
  for (const st of allStaff) {
    for (const day of days) {
      await prisma.staffWorkingHours.create({
        data: {
          staffId: st.id,
          dayOfWeek: day,
          isWorking: true,
          startTime: '10:00',
          endTime: '20:00',
        },
      });

      // Lunch break: 13:00 - 14:00
      await prisma.staffBreak.create({
        data: {
          staffId: st.id,
          dayOfWeek: day,
          startTime: '13:00',
          endTime: '14:00',
          title: 'Lunch Break',
        },
      });
    }
  }

  // 12. Sample Customers
  const custAarav = await prisma.customer.create({
    data: {
      salonId: salon.id,
      name: 'Aarav Gupta',
      phone: '+919822233344',
      email: 'aarav@example.com',
      totalVisits: 3,
      totalSpend: 2200.0,
      lastVisitAt: new Date(),
    },
  });

  const custAnanya = await prisma.customer.create({
    data: {
      salonId: salon.id,
      name: 'Ananya Roy',
      phone: '+919833344455',
      email: 'ananya@example.com',
      totalVisits: 2,
      totalSpend: 4000.0,
      lastVisitAt: new Date(),
    },
  });

  const custVikram = await prisma.customer.create({
    data: {
      salonId: salon.id,
      name: 'Vikram Malhotra',
      phone: '+919855566677',
      totalVisits: 1,
      totalSpend: 500.0,
      lastVisitAt: new Date(),
    },
  });

  // 13. Sample Appointments for Today in Asia/Kolkata
  const todayInKolkata = DateTime.now().setZone('Asia/Kolkata');
  const todayJs = todayInKolkata.startOf('day').toJSDate();

  // Appt 1: Aarav - Haircut with Rahul at 10:30 AM (Completed)
  const appt1Start = todayInKolkata.set({ hour: 10, minute: 30, second: 0, millisecond: 0 });
  const appt1End = appt1Start.plus({ minutes: 30 });

  const appt1 = await prisma.appointment.create({
    data: {
      appointmentNumber: 'SAL-1001',
      salonId: salon.id,
      customerId: custAarav.id,
      staffId: staffRahul.id,
      serviceId: svcHaircut.id,
      date: todayJs,
      startTime: appt1Start.toUTC().toJSDate(),
      endTime: appt1End.toUTC().toJSDate(),
      price: svcHaircut.price,
      status: AppointmentStatus.COMPLETED,
      source: BookingSource.WEB,
      notes: 'Customer requested taper fade.',
    },
  });

  // Appt 2: Ananya - Facial with Priya at 11:30 AM (In Service)
  const appt2Start = todayInKolkata.set({ hour: 11, minute: 30, second: 0, millisecond: 0 });
  const appt2End = appt2Start.plus({ minutes: 60 });

  const appt2 = await prisma.appointment.create({
    data: {
      appointmentNumber: 'SAL-1002',
      salonId: salon.id,
      customerId: custAnanya.id,
      staffId: staffPriya.id,
      serviceId: svcFacial.id,
      date: todayJs,
      startTime: appt2Start.toUTC().toJSDate(),
      endTime: appt2End.toUTC().toJSDate(),
      price: svcFacial.price,
      status: AppointmentStatus.IN_SERVICE,
      source: BookingSource.WHATSAPP,
      notes: 'Sensitive skin product applied.',
    },
  });

  // Appt 3: Vikram - Haircut with Amit at 16:00 PM (Confirmed upcoming)
  const appt3Start = todayInKolkata.set({ hour: 16, minute: 0, second: 0, millisecond: 0 });
  const appt3End = appt3Start.plus({ minutes: 30 });

  const appt3 = await prisma.appointment.create({
    data: {
      appointmentNumber: 'SAL-1003',
      salonId: salon.id,
      customerId: custVikram.id,
      staffId: staffAmit.id,
      serviceId: svcHaircut.id,
      date: todayJs,
      startTime: appt3Start.toUTC().toJSDate(),
      endTime: appt3End.toUTC().toJSDate(),
      price: svcHaircut.price,
      status: AppointmentStatus.CONFIRMED,
      source: BookingSource.WALK_IN,
      notes: 'Walk-in booking.',
    },
  });

  console.log('✅ Database seeded successfully!');
  console.log('🔑 Credentials:');
  console.log('   Platform Admin: admin@salonsaas.com / Password123!');
  console.log('   Salon Admin:    owner@glamourstudio.com / Password123!');
  console.log('   Public Booking URL Slug: /book/glamour-studio');
}

main()
  .catch((e) => {
    console.error('❌ Error during seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
