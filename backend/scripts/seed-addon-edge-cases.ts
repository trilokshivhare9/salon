import { PrismaClient, AppointmentStatus, BookingSource, BookingType } from '@prisma/client';
import { DateTime } from 'luxon';

const prisma = new PrismaClient();

async function main() {
  console.log('🚀 [Seeder] Setting up Add-on Service Edge-Case Test Scenarios...\n');

  const salon = await prisma.salon.findFirst({
    where: { status: 'ACTIVE' },
    include: {
      stylists: { where: { status: 'ACTIVE' } },
      services: { where: { status: 'ACTIVE' } },
    },
  });

  if (!salon) {
    console.error('❌ No active salon found!');
    return;
  }

  console.log(`Salon: "${salon.name}" (${salon.id})`);
  const timezone = salon.timezone || 'Asia/Kolkata';
  const now = DateTime.now().setZone(timezone);
  const todayIso = now.toISODate()!;
  const todayDbDate = new Date(`${todayIso}T00:00:00.000Z`);

  const stylists = salon.stylists;
  if (stylists.length < 2) {
    console.error('❌ Need at least 2 active stylists for test scenarios.');
    return;
  }

  const stylistAlex = stylists[0];
  const stylistPriya = stylists[1];
  console.log(`Stylist 1: ${stylistAlex.name} (${stylistAlex.id})`);
  console.log(`Stylist 2: ${stylistPriya.name} (${stylistPriya.id})\n`);

  // 1. Ensure diverse service durations exist
  console.log('📦 Ensuring test service catalog with diverse durations...');
  const desiredServices = [
    { name: 'Express Hair Wash & Dry', durationMinutes: 10, price: 150, category: 'Hair Care', icon: '🧼' },
    { name: 'Scalp Massage Express', durationMinutes: 15, price: 250, category: 'Spa & Relax', icon: '💆' },
    { name: 'Beard Trim & Lineup', durationMinutes: 20, price: 200, category: 'Beard Grooming', icon: '🧔' },
    { name: 'Classic Precision Haircut', durationMinutes: 30, price: 350, category: 'Hair Care', icon: '✂️' },
    { name: 'Deep Cleansing Glow Facial', durationMinutes: 45, price: 850, category: 'Skin Care', icon: '🧴' },
    { name: 'Luxury Keratin Hair Spa', durationMinutes: 60, price: 1600, category: 'Hair Care', icon: '✨' },
  ];

  for (const s of desiredServices) {
    const existing = await prisma.service.findFirst({
      where: { salonId: salon.id, name: s.name },
    });
    if (!existing) {
      await prisma.service.create({
        data: {
          salonId: salon.id,
          name: s.name,
          durationMinutes: s.durationMinutes,
          price: s.price,
          category: s.category,
          status: 'ACTIVE',
        },
      });
      console.log(`  ➕ Created service: ${s.name} (${s.durationMinutes}m - ₹${s.price})`);
    }
  }

  // 2. Helper to get or create salon user
  async function getOrCreateSalonUser(name: string, phone: string) {
    let user = await prisma.user.findUnique({ where: { phone } });
    if (!user) {
      user = await prisma.user.create({
        data: { name, phone },
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

  // 3. Clear existing test appointments for today to prevent messy collisions
  console.log('\n🧹 Clearing old appointments for today in test salon...');
  await prisma.appointmentService.deleteMany({
    where: {
      salonId: salon.id,
      appointment: { appointmentDate: todayDbDate },
    },
  });
  await prisma.appointment.deleteMany({
    where: {
      salonId: salon.id,
      appointmentDate: todayDbDate,
    },
  });

  const baseSvc = await prisma.service.findFirst({
    where: { salonId: salon.id, durationMinutes: 30 },
  });

  // Helper to create an appointment
  async function createTestAppt(
    clientName: string,
    phone: string,
    stylistId: string,
    startHour: number,
    startMinute: number,
    durMin: number,
    status: AppointmentStatus,
    label: string,
  ) {
    const su = await getOrCreateSalonUser(clientName, phone);
    const startDt = now.set({ hour: startHour, minute: startMinute, second: 0, millisecond: 0 });
    const endDt = startDt.plus({ minutes: durMin });
    const apptNum = `APT-${Math.floor(1000 + Math.random() * 9000)}`;

    const appt = await prisma.appointment.create({
      data: {
        appointmentNumber: apptNum,
        salonId: salon.id,
        salonUserId: su.id,
        stylistId,
        serviceId: baseSvc?.id,
        serviceNameSnapshot: `${baseSvc?.name || 'Haircut'} [${label}]`,
        durationMinutes: durMin,
        price: baseSvc?.price || 350,
        appointmentDate: todayDbDate,
        startAt: startDt.toJSDate(),
        endAt: endDt.toJSDate(),
        bookingType: BookingType.NORMAL,
        status,
        source: BookingSource.WEB,
        notes: label,
      },
    });

    await prisma.appointmentService.create({
      data: {
        salonId: salon.id,
        appointmentId: appt.id,
        serviceId: baseSvc?.id,
        serviceNameSnapshot: baseSvc?.name || 'Haircut',
        durationMinutes: durMin,
        price: baseSvc?.price || 350,
        orderIndex: 0,
      },
    });

    return {
      appt,
      timeStr: `${startDt.toFormat('hh:mm a')} - ${endDt.toFormat('hh:mm a')}`,
    };
  }

  console.log('\n======================================================');
  console.log('🎯 Seeding 4 Edge-Case Scenarios:');
  console.log('======================================================');

  // SCENARIO 1: Alex Johnson - 15-Minute Window
  // Appt 1: 12:00 PM - 12:30 PM (Testing this)
  // Appt 2: 12:45 PM - 01:15 PM (Next client starts in 15 mins)
  const sc1 = await createTestAppt(
    'Rohan Gupta (15m Gap Test)',
    '+919800000001',
    stylistAlex.id,
    12, 0, 30,
    AppointmentStatus.SEATED_IN_CHAIR,
    'TEST: 15-Min Gap',
  );
  await createTestAppt(
    'Vikram Seth',
    '+919800000002',
    stylistAlex.id,
    12, 45, 30,
    AppointmentStatus.CONFIRMED,
    'Blocker at 12:45 PM',
  );
  console.log(`✅ Scenario 1 [15-Min Free Window]:`);
  console.log(`   Client: Rohan Gupta (Alex Johnson) | ${sc1.timeStr}`);
  console.log(`   Next Client at 12:45 PM | Window = 15 Minutes`);
  console.log(`   Expected: Only 10m & 15m services eligible.`);
  console.log(`   Appointment ID: ${sc1.appt.id}\n`);

  // SCENARIO 2: Alex Johnson - 30-Minute Window
  // Appt 3: 02:00 PM - 02:30 PM (Testing this)
  // Appt 4: 03:00 PM - 03:45 PM (Next client starts in 30 mins)
  const sc2 = await createTestAppt(
    'Aditya Roy (30m Gap Test)',
    '+919800000003',
    stylistAlex.id,
    14, 0, 30,
    AppointmentStatus.CHECKED_IN,
    'TEST: 30-Min Gap',
  );
  await createTestAppt(
    'Manish Malhotra',
    '+919800000004',
    stylistAlex.id,
    15, 0, 45,
    AppointmentStatus.CONFIRMED,
    'Blocker at 03:00 PM',
  );
  console.log(`✅ Scenario 2 [30-Min Free Window]:`);
  console.log(`   Client: Aditya Roy (Alex Johnson) | ${sc2.timeStr}`);
  console.log(`   Next Client at 03:00 PM | Window = 30 Minutes`);
  console.log(`   Expected: Services <= 30m eligible (10m, 15m, 20m, 30m). 45m & 60m blocked.`);
  console.log(`   Appointment ID: ${sc2.appt.id}\n`);

  // SCENARIO 3: Priya Sharma - 0-Minute Window (Back-to-Back)
  // Appt 5: 01:00 PM - 01:30 PM (Testing this)
  // Appt 6: 01:30 PM - 02:00 PM (Direct back-to-back!)
  const sc3 = await createTestAppt(
    'Sneha Kapoor (0m Back-to-Back Test)',
    '+919800000005',
    stylistPriya.id,
    13, 0, 30,
    AppointmentStatus.SEATED_IN_CHAIR,
    'TEST: 0-Min Back-to-Back',
  );
  await createTestAppt(
    'Kavita Rao',
    '+919800000006',
    stylistPriya.id,
    13, 30, 30,
    AppointmentStatus.CONFIRMED,
    'Blocker at 01:30 PM',
  );
  console.log(`✅ Scenario 3 [0-Min Back-to-Back]:`);
  console.log(`   Client: Sneha Kapoor (Priya Sharma) | ${sc3.timeStr}`);
  console.log(`   Next Client at 01:30 PM | Window = 0 Minutes`);
  console.log(`   Expected: ALL services blocked with "Back-to-back: Next client at 01:30 PM".`);
  console.log(`   Appointment ID: ${sc3.appt.id}\n`);

  // SCENARIO 4: Priya Sharma - Open Window (End of Day)
  // Appt 7: 05:00 PM - 05:30 PM
  // No more bookings today (closes at 9:00 PM)
  const sc4 = await createTestAppt(
    'Ananya Panday (Wide Open Window Test)',
    '+919800000007',
    stylistPriya.id,
    17, 0, 30,
    AppointmentStatus.CONFIRMED,
    'TEST: Open Window',
  );
  console.log(`✅ Scenario 4 [Wide Open Window]:`);
  console.log(`   Client: Ananya Panday (Priya Sharma) | ${sc4.timeStr}`);
  console.log(`   No more bookings today | Closes at 09:00 PM`);
  console.log(`   Expected: ALL services eligible.`);
  console.log(`   Appointment ID: ${sc4.appt.id}\n`);

  console.log('🎉 Successfully seeded edge-case test appointments into local database!');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('Fatal error seeding edge cases:', e);
  process.exit(1);
});
