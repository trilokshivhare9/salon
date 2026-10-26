import { PrismaClient, AppointmentStatus, BookingSource } from '@prisma/client';
import { DateTime } from 'luxon';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 [Seeder] Seeding rich, interactive demo data for Salon Dashboard...');

  // Target both salons so both show rich data
  const salons = await prisma.salon.findMany({
    where: { status: 'ACTIVE' },
    include: {
      stylists: { where: { status: 'ACTIVE' } },
      services: { where: { status: 'ACTIVE' } },
    },
  });

  for (const salon of salons) {
    console.log(`\n======================================================`);
    console.log(`Processing Salon: "${salon.name}" (${salon.slug})`);
    console.log(`======================================================`);

    const timezone = salon.timezone || 'Asia/Kolkata';
    const now = DateTime.now().setZone(timezone);
    const todayIso = now.toISODate()!;
    const todayDbDate = new Date(`${todayIso}T00:00:00.000Z`);

    const stylists = salon.stylists;
    const services = salon.services;

    if (stylists.length === 0 || services.length === 0) {
      console.warn(`  ⚠️ Salon ${salon.name} has 0 stylists or 0 services, skipping.`);
      continue;
    }

    // Helper to get or create salon user
    async function getOrCreateSalonUser(name: string, phone: string, email?: string) {
      let user = await prisma.user.findUnique({ where: { phone } });
      if (!user) {
        user = await prisma.user.create({
          data: { name, phone, email },
        });
      }
      let su = await prisma.salonUser.findFirst({
        where: { salonId: salon.id, userId: user.id },
      });
      if (!su) {
        su = await prisma.salonUser.create({
          data: { salonId: salon.id, userId: user.id },
        });
      }
      return su;
    }

    // Define 12 realistic clients
    const clients = [
      await getOrCreateSalonUser('Rahul Sharma', '+919876543210', 'rahul@example.com'),
      await getOrCreateSalonUser('Priya Patel', '+919876543211', 'priya@example.com'),
      await getOrCreateSalonUser('Kabir Malhotra', '+919876543218', 'kabir@example.com'),
      await getOrCreateSalonUser('Amit Verma', '+919876543212', 'amit@example.com'),
      await getOrCreateSalonUser('Sneha Gupta', '+919876543213', 'sneha@example.com'),
      await getOrCreateSalonUser('Rohan Deshmukh', '+919876543217', 'rohan@example.com'),
      await getOrCreateSalonUser('Vikram Rao', '+919876543214', 'vikram@example.com'),
      await getOrCreateSalonUser('Pooja Mehta', '+919876543215', 'pooja@example.com'),
      await getOrCreateSalonUser('Ananya Roy', '+919876543216', 'ananya@example.com'),
      await getOrCreateSalonUser('Rajesh Khanna', '+919876543219', 'rajesh@example.com'),
      await getOrCreateSalonUser('Simran Kaur', '+919876543220', 'simran@example.com'),
      await getOrCreateSalonUser('Devendra Joshi', '+919876543221', 'devendra@example.com'),
    ];

    // Remove existing test appointments created for today to prevent duplicates
    const deleted = await prisma.appointment.deleteMany({
      where: {
        salonId: salon.id,
        appointmentDate: todayDbDate,
      },
    });
    console.log(`  - Cleared ${deleted.count} existing appointments for today (${todayIso})`);

    // Appointment 1: Quick Booking (PENDING_ACCEPTANCE from WhatsApp)
    const s1 = services[0];
    const st1 = stylists[0];
    await prisma.appointment.create({
      data: {
        appointmentNumber: `SAL-${Math.floor(100000 + Math.random() * 900000)}`,
        salonId: salon.id,
        salonUserId: clients[0].id,
        stylistId: st1.id,
        serviceId: s1.id,
        serviceNameSnapshot: s1.name,
        price: s1.price,
        durationMinutes: s1.durationMinutes || 30,
        startAt: now.plus({ minutes: 35 }).toJSDate(),
        endAt: now.plus({ minutes: 65 }).toJSDate(),
        appointmentDate: todayDbDate,
        status: AppointmentStatus.PENDING_ACCEPTANCE,
        source: BookingSource.WHATSAPP,
        notes: 'Requested haircut via WhatsApp Bot',
      },
    });
    console.log(`  ✓ Added Quick Booking 1: Rahul Sharma (Pending WhatsApp approval)`);

    // Appointment 2: Quick Booking (PENDING_ACCEPTANCE from Store QR / Quick Book)
    const s2 = services[1] || services[0];
    const st2 = stylists[1] || stylists[0];
    await prisma.appointment.create({
      data: {
        appointmentNumber: `SAL-${Math.floor(100000 + Math.random() * 900000)}`,
        salonId: salon.id,
        salonUserId: clients[1].id,
        stylistId: st2.id,
        serviceId: s2.id,
        serviceNameSnapshot: s2.name,
        price: s2.price,
        durationMinutes: s2.durationMinutes || 45,
        startAt: now.plus({ minutes: 50 }).toJSDate(),
        endAt: now.plus({ minutes: 95 }).toJSDate(),
        appointmentDate: todayDbDate,
        status: AppointmentStatus.PENDING_ACCEPTANCE,
        source: BookingSource.QUICK_BOOK,
        notes: 'Booked via Store QR Standee',
      },
    });
    console.log(`  ✓ Added Quick Booking 2: Priya Patel (Pending Quick Book QR approval)`);

    // Appointment 3: Quick Booking (PENDING_ACCEPTANCE from Customer App)
    const s3 = services[2] || services[0];
    const st3 = stylists[2] || stylists[0];
    await prisma.appointment.create({
      data: {
        appointmentNumber: `SAL-${Math.floor(100000 + Math.random() * 900000)}`,
        salonId: salon.id,
        salonUserId: clients[2].id,
        stylistId: st3.id,
        serviceId: s3.id,
        serviceNameSnapshot: s3.name,
        price: s3.price,
        durationMinutes: s3.durationMinutes || 40,
        startAt: now.plus({ minutes: 60 }).toJSDate(),
        endAt: now.plus({ minutes: 100 }).toJSDate(),
        appointmentDate: todayDbDate,
        status: AppointmentStatus.PENDING_ACCEPTANCE,
        source: BookingSource.CUSTOMER_APP,
        notes: 'Requested via Customer Mobile App',
      },
    });
    console.log(`  ✓ Added Quick Booking 3: Kabir Malhotra (Pending Customer App approval)`);

    // Appointment 4: Upcoming (CHECKED_IN - Waiting on floor lobby)
    const s4 = services[0];
    const st4 = stylists[3] || stylists[0];
    await prisma.appointment.create({
      data: {
        appointmentNumber: `SAL-${Math.floor(100000 + Math.random() * 900000)}`,
        salonId: salon.id,
        salonUserId: clients[3].id,
        stylistId: st4.id,
        serviceId: s4.id,
        serviceNameSnapshot: s4.name,
        price: s4.price,
        durationMinutes: s4.durationMinutes || 30,
        startAt: now.plus({ minutes: 10 }).toJSDate(),
        endAt: now.plus({ minutes: 40 }).toJSDate(),
        appointmentDate: todayDbDate,
        status: AppointmentStatus.CHECKED_IN,
        source: BookingSource.WALK_IN,
        notes: 'Client arrived, seated in waiting lobby',
      },
    });
    console.log(`  ✓ Added Upcoming 1: Amit Verma (CHECKED_IN - In Waiting Area)`);

    // Appointment 5: Upcoming (CONFIRMED - Arriving shortly)
    const s5 = services[1] || services[0];
    const st5 = stylists[4] || stylists[1] || stylists[0];
    await prisma.appointment.create({
      data: {
        appointmentNumber: `SAL-${Math.floor(100000 + Math.random() * 900000)}`,
        salonId: salon.id,
        salonUserId: clients[4].id,
        stylistId: st5.id,
        serviceId: s5.id,
        serviceNameSnapshot: s5.name,
        price: s5.price,
        durationMinutes: s5.durationMinutes || 45,
        startAt: now.plus({ minutes: 25 }).toJSDate(),
        endAt: now.plus({ minutes: 70 }).toJSDate(),
        appointmentDate: todayDbDate,
        status: AppointmentStatus.CONFIRMED,
        source: BookingSource.WHATSAPP,
        notes: 'Confirmed appointment for afternoon',
      },
    });
    console.log(`  ✓ Added Upcoming 2: Sneha Gupta (CONFIRMED - Arriving shortly)`);

    // Appointment 6: Upcoming (BOOKED - Scheduled in line)
    const s6 = services[2] || services[0];
    const st6 = stylists[5] || stylists[2] || stylists[0];
    await prisma.appointment.create({
      data: {
        appointmentNumber: `SAL-${Math.floor(100000 + Math.random() * 900000)}`,
        salonId: salon.id,
        salonUserId: clients[5].id,
        stylistId: st6.id,
        serviceId: s6.id,
        serviceNameSnapshot: s6.name,
        price: s6.price,
        durationMinutes: s6.durationMinutes || 30,
        startAt: now.plus({ minutes: 55 }).toJSDate(),
        endAt: now.plus({ minutes: 85 }).toJSDate(),
        appointmentDate: todayDbDate,
        status: AppointmentStatus.BOOKED,
        source: BookingSource.WEB,
        notes: 'Website booking for afternoon session',
      },
    });
    console.log(`  ✓ Added Upcoming 3: Rohan Deshmukh (BOOKED - In line)`);

    // Appointment 7: In-Chair (SEATED_IN_CHAIR - Busy right now with Stylist 0)
    const s7 = services[1] || services[0];
    const st7 = stylists[0];
    await prisma.appointment.create({
      data: {
        appointmentNumber: `SAL-${Math.floor(100000 + Math.random() * 900000)}`,
        salonId: salon.id,
        salonUserId: clients[6].id,
        stylistId: st7.id,
        serviceId: s7.id,
        serviceNameSnapshot: s7.name,
        price: s7.price,
        durationMinutes: s7.durationMinutes || 45,
        startAt: now.minus({ minutes: 20 }).toJSDate(),
        endAt: now.plus({ minutes: 25 }).toJSDate(),
        appointmentDate: todayDbDate,
        status: AppointmentStatus.SEATED_IN_CHAIR,
        source: BookingSource.WALK_IN,
        notes: 'Service in progress',
      },
    });
    console.log(`  ✓ Added In-Chair 1: Vikram Rao with ${st7.name} (SEATED_IN_CHAIR)`);

    // Appointment 8: In-Chair (SEATED_IN_CHAIR - Busy right now with Stylist 1)
    const s8 = services[2] || services[0];
    const st8 = stylists[1] || stylists[0];
    await prisma.appointment.create({
      data: {
        appointmentNumber: `SAL-${Math.floor(100000 + Math.random() * 900000)}`,
        salonId: salon.id,
        salonUserId: clients[7].id,
        stylistId: st8.id,
        serviceId: s8.id,
        serviceNameSnapshot: s8.name,
        price: s8.price,
        durationMinutes: s8.durationMinutes || 60,
        startAt: now.minus({ minutes: 30 }).toJSDate(),
        endAt: now.plus({ minutes: 30 }).toJSDate(),
        appointmentDate: todayDbDate,
        status: AppointmentStatus.SEATED_IN_CHAIR,
        source: BookingSource.CUSTOMER_APP,
        notes: 'Deluxe treatment in progress',
      },
    });
    console.log(`  ✓ Added In-Chair 2: Pooja Mehta with ${st8.name} (SEATED_IN_CHAIR)`);

    // Appointment 9: Completed Visit 1 (Earned revenue)
    await prisma.appointment.create({
      data: {
        appointmentNumber: `SAL-${Math.floor(100000 + Math.random() * 900000)}`,
        salonId: salon.id,
        salonUserId: clients[8].id,
        stylistId: stylists[2]?.id || stylists[0].id,
        serviceId: s1.id,
        serviceNameSnapshot: s1.name,
        price: 350,
        durationMinutes: 30,
        startAt: now.minus({ hours: 4 }).toJSDate(),
        endAt: now.minus({ hours: 3, minutes: 30 }).toJSDate(),
        appointmentDate: todayDbDate,
        status: AppointmentStatus.COMPLETED,
        source: BookingSource.WALK_IN,
      },
    });
    console.log(`  ✓ Added Completed 1: Ananya Roy (₹350)`);

    // Appointment 10: Completed Visit 2 (Earned revenue)
    await prisma.appointment.create({
      data: {
        appointmentNumber: `SAL-${Math.floor(100000 + Math.random() * 900000)}`,
        salonId: salon.id,
        salonUserId: clients[9].id,
        stylistId: stylists[3]?.id || stylists[0].id,
        serviceId: s2.id,
        serviceNameSnapshot: s2.name,
        price: 1200,
        durationMinutes: 60,
        startAt: now.minus({ hours: 3 }).toJSDate(),
        endAt: now.minus({ hours: 2 }).toJSDate(),
        appointmentDate: todayDbDate,
        status: AppointmentStatus.COMPLETED,
        source: BookingSource.WHATSAPP,
      },
    });
    console.log(`  ✓ Added Completed 2: Rajesh Khanna (₹1,200)`);

    // Appointment 11: Completed Visit 3 (Earned revenue)
    await prisma.appointment.create({
      data: {
        appointmentNumber: `SAL-${Math.floor(100000 + Math.random() * 900000)}`,
        salonId: salon.id,
        salonUserId: clients[10].id,
        stylistId: stylists[4]?.id || stylists[0].id,
        serviceId: s3.id,
        serviceNameSnapshot: s3.name,
        price: 1800,
        durationMinutes: 75,
        startAt: now.minus({ hours: 2 }).toJSDate(),
        endAt: now.minus({ hours: 45, minutes: 0 }).toJSDate(),
        appointmentDate: todayDbDate,
        status: AppointmentStatus.COMPLETED,
        source: BookingSource.WEB,
      },
    });
    console.log(`  ✓ Added Completed 3: Simran Kaur (₹1,800)`);

    // Appointment 12: Completed Visit 4 (Earned revenue)
    await prisma.appointment.create({
      data: {
        appointmentNumber: `SAL-${Math.floor(100000 + Math.random() * 900000)}`,
        salonId: salon.id,
        salonUserId: clients[11].id,
        stylistId: stylists[5]?.id || stylists[0].id,
        serviceId: s1.id,
        serviceNameSnapshot: s1.name,
        price: 450,
        durationMinutes: 30,
        startAt: now.minus({ hours: 1, minutes: 15 }).toJSDate(),
        endAt: now.minus({ minutes: 45 }).toJSDate(),
        appointmentDate: todayDbDate,
        status: AppointmentStatus.COMPLETED,
        source: BookingSource.CUSTOMER_APP,
      },
    });
    console.log(`  ✓ Added Completed 4: Devendra Joshi (₹450)`);

    console.log(`\n🎉 Successfully seeded 12 appointments for "${salon.name}":`);
    console.log(`   - 3 Quick Bookings awaiting approval (WhatsApp, Store QR, Customer App)`);
    console.log(`   - 3 Upcoming Queue visits (Checked-In, Confirmed, Booked)`);
    console.log(`   - 2 In-Chair visits (Actively in chairs right now)`);
    console.log(`   - 4 Completed visits (Total Today Revenue: ₹3,800)`);
  }

  console.log('\n✅ All salons seeded with rich interactive data! Open your browser to test.');
}

main()
  .catch((e) => {
    console.error('❌ Seeder error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
