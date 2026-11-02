import { PrismaClient, AppointmentStatus, BookingSource, BookingType } from '@prisma/client';
import { DateTime } from 'luxon';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 [Seeder] Seeding all booking types for today...');

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

    // Define distinct clients
    const clients = [
      await getOrCreateSalonUser('Vikram Malhotra', '+919876543211', 'vikram.m@example.com'),
      await getOrCreateSalonUser('Pooja Sharma', '+919876543212', 'pooja.s@example.com'),
      await getOrCreateSalonUser('Neha Verma', '+919876543214', 'neha.v@example.com'),
      await getOrCreateSalonUser('Amit Patel', '+919876543213', 'amit.p@example.com'),
      await getOrCreateSalonUser('Rohan Deshmukh', '+919876543217', 'rohan.d@example.com'),
      await getOrCreateSalonUser('Rahul Sharma', '+919876543210', 'rahul.s@example.com'),
      await getOrCreateSalonUser('Ananya Roy', '+919876543216', 'ananya.r@example.com'),
      await getOrCreateSalonUser('Rajesh Khanna', '+919876543219', 'rajesh.k@example.com'),
      await getOrCreateSalonUser('Simran Kaur', '+919876543220', 'simran.k@example.com'),
      await getOrCreateSalonUser('Sameer Joshi', '+919876543218', 'sameer.j@example.com'),
    ];

    // Remove existing test appointments created for today to prevent duplicates
    const deleted = await prisma.appointment.deleteMany({
      where: {
        salonId: salon.id,
        appointmentDate: todayDbDate,
      },
    });
    console.log(`  - Cleared ${deleted.count} existing appointments for today (${todayIso})`);

    const defaultStylist = stylists[0];

    // Helper to create appointment and its appointmentService row
    async function createTestAppointment(opts: {
      client: any;
      stylist?: any;
      service: any;
      status: AppointmentStatus;
      bookingType: BookingType;
      source: BookingSource;
      startAt: DateTime;
      endAt: DateTime;
      price: number;
      notes?: string;
      reason?: string;
    }) {
      const st = opts.stylist || defaultStylist;
      const svc = opts.service;
      const num = `APT-${Math.floor(100000 + Math.random() * 900000)}`;

      const appt = await prisma.appointment.create({
        data: {
          appointmentNumber: num,
          salonId: salon.id,
          salonUserId: opts.client.id,
          stylistId: st.id,
          serviceId: svc.id,
          serviceNameSnapshot: svc.name,
          price: opts.price,
          durationMinutes: svc.durationMinutes || 30,
          startAt: opts.startAt.toJSDate(),
          endAt: opts.endAt.toJSDate(),
          appointmentDate: todayDbDate,
          status: opts.status,
          bookingType: opts.bookingType,
          source: opts.source,
          notes: opts.notes || null,
          cancellationReason: opts.reason || null,
        },
      });

      await prisma.appointmentService.create({
        data: {
          salonId: salon.id,
          appointmentId: appt.id,
          serviceId: svc.id,
          serviceNameSnapshot: svc.name,
          durationMinutes: svc.durationMinutes || 30,
          price: opts.price,
          orderIndex: 0,
        },
      });

      return appt;
    }

    // 1. IN CHAIR (SEATED_IN_CHAIR - Walk-In client seated currently)
    await createTestAppointment({
      client: clients[0],
      service: services[0],
      status: AppointmentStatus.SEATED_IN_CHAIR,
      bookingType: BookingType.NORMAL,
      source: BookingSource.WALK_IN,
      startAt: now.minus({ minutes: 20 }),
      endAt: now.plus({ minutes: 25 }),
      price: Number(services[0].price) || 450,
      notes: 'Currently seated in chair (service in progress)',
    });
    console.log(`  ✓ Added [IN_CHAIR]: Vikram Malhotra (Walk-In, in chair right now)`);

    // 2. IN QUEUE - CHECKED_IN (Waiting in lobby)
    await createTestAppointment({
      client: clients[1],
      service: services[1] || services[0],
      status: AppointmentStatus.CHECKED_IN,
      bookingType: BookingType.QUICK,
      source: BookingSource.WHATSAPP,
      startAt: now.plus({ minutes: 15 }),
      endAt: now.plus({ minutes: 45 }),
      price: Number(services[1]?.price || services[0].price) || 350,
      notes: 'Client arrived, seated in waiting area',
    });
    console.log(`  ✓ Added [CHECKED_IN]: Pooja Sharma (WhatsApp Quick Booking, in lobby)`);

    // 3. IN QUEUE - ON_THE_WAY (Client travelling)
    await createTestAppointment({
      client: clients[2],
      service: services[2] || services[0],
      status: AppointmentStatus.ON_THE_WAY,
      bookingType: BookingType.NORMAL,
      source: BookingSource.WHATSAPP,
      startAt: now.plus({ minutes: 35 }),
      endAt: now.plus({ minutes: 80 }),
      price: Number(services[2]?.price || services[0].price) || 800,
      notes: 'Client confirmed WhatsApp ETA: On the way',
    });
    console.log(`  ✓ Added [ON_THE_WAY]: Neha Verma (WhatsApp, travelling)`);

    // 4. IN QUEUE - CONFIRMED (Scheduled appointment)
    await createTestAppointment({
      client: clients[3],
      service: services[3] || services[0],
      status: AppointmentStatus.CONFIRMED,
      bookingType: BookingType.NORMAL,
      source: BookingSource.WEB,
      startAt: now.plus({ hours: 1, minutes: 30 }),
      endAt: now.plus({ hours: 2, minutes: 15 }),
      price: Number(services[3]?.price || services[0].price) || 1200,
      notes: 'Online pre-booking confirmed',
    });
    console.log(`  ✓ Added [CONFIRMED]: Amit Patel (Web Booking, confirmed)`);

    // 5. IN QUEUE - BOOKED (Evening scheduled visit)
    await createTestAppointment({
      client: clients[4],
      service: services[4] || services[0],
      status: AppointmentStatus.BOOKED,
      bookingType: BookingType.NORMAL,
      source: BookingSource.CUSTOMER_APP,
      startAt: now.plus({ hours: 3 }),
      endAt: now.plus({ hours: 3, minutes: 45 }),
      price: Number(services[4]?.price || services[0].price) || 600,
      notes: 'Mobile app evening booking',
    });
    console.log(`  ✓ Added [BOOKED]: Rohan Deshmukh (Customer App, booked)`);

    // 6. QUICK BOOKING - PENDING_ACCEPTANCE (Requires salon approval)
    await createTestAppointment({
      client: clients[5],
      service: services[0],
      status: AppointmentStatus.PENDING_ACCEPTANCE,
      bookingType: BookingType.QUICK,
      source: BookingSource.WHATSAPP,
      startAt: now.plus({ hours: 2 }),
      endAt: now.plus({ hours: 2, minutes: 30 }),
      price: Number(services[0].price) || 400,
      notes: 'Quick booking requested via WhatsApp bot, awaiting salon confirmation',
    });
    console.log(`  ✓ Added [PENDING_ACCEPTANCE]: Rahul Sharma (WhatsApp Quick Request)`);

    // 7. COMPLETED #1 (Earlier today - Revenue earned)
    await createTestAppointment({
      client: clients[6],
      service: services[0],
      status: AppointmentStatus.COMPLETED,
      bookingType: BookingType.NORMAL,
      source: BookingSource.WALK_IN,
      startAt: now.minus({ hours: 4 }),
      endAt: now.minus({ hours: 3, minutes: 15 }),
      price: 750,
      notes: 'Walk-in service completed successfully',
    });
    console.log(`  ✓ Added [COMPLETED]: Ananya Roy (₹750 revenue)`);

    // 8. COMPLETED #2 (Earlier today - Revenue earned)
    await createTestAppointment({
      client: clients[7],
      service: services[1] || services[0],
      status: AppointmentStatus.COMPLETED,
      bookingType: BookingType.NORMAL,
      source: BookingSource.WHATSAPP,
      startAt: now.minus({ hours: 3 }),
      endAt: now.minus({ hours: 1, minutes: 30 }),
      price: 1400,
      notes: 'Hair highlights and treatment complete',
    });
    console.log(`  ✓ Added [COMPLETED]: Rajesh Khanna (₹1,400 revenue)`);

    // 9. COMPLETED #3 (Earlier today - Revenue earned)
    await createTestAppointment({
      client: clients[8],
      service: services[2] || services[0],
      status: AppointmentStatus.COMPLETED,
      bookingType: BookingType.NORMAL,
      source: BookingSource.WEB,
      startAt: now.minus({ hours: 1, minutes: 30 }),
      endAt: now.minus({ minutes: 45 }),
      price: 950,
      notes: 'Styling package complete',
    });
    console.log(`  ✓ Added [COMPLETED]: Simran Kaur (₹950 revenue)`);

    // 10. CANCELLED (Cancelled booking)
    await createTestAppointment({
      client: clients[9],
      service: services[0],
      status: AppointmentStatus.CANCELLED,
      bookingType: BookingType.NORMAL,
      source: BookingSource.WEB,
      startAt: now.minus({ hours: 2 }),
      endAt: now.minus({ hours: 1, minutes: 15 }),
      price: 500,
      reason: 'Client requested reschedule to next week',
    });
    console.log(`  ✓ Added [CANCELLED]: Sameer Joshi (Rescheduled)`);

    console.log(`\n🎉 Successfully seeded all booking types for "${salon.name}":`);
    console.log(`   - 1 In-Chair (Seated right now)`);
    console.log(`   - 4 In-Queue (Checked-In, On The Way, Confirmed, Booked)`);
    console.log(`   - 1 Quick Booking Request (Pending Acceptance)`);
    console.log(`   - 3 Completed visits (Total Today Revenue: ₹3,100)`);
    console.log(`   - 1 Cancelled booking`);
  }

  console.log('\n✅ All booking types seeded successfully for today! Ready for testing.');
}

main()
  .catch((e) => {
    console.error('❌ Seeder error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
