import { PrismaClient, AppointmentStatus, BookingSource, BookingType, ClientEtaStatus, CancelledBy } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding rich appointments with ALL 10 statuses for today...');

  const salon = await prisma.salon.findFirst({
    where: { slug: 'dbtech' },
  });

  if (!salon) {
    console.error('❌ Salon "dbtech" not found!');
    return;
  }
  console.log(`💈 Salon found: ${salon.name} (${salon.id})`);

  // Fetch stylists
  const stylists = await prisma.stylist.findMany({
    where: { salonId: salon.id, status: 'ACTIVE' },
  });
  if (stylists.length === 0) {
    console.error('❌ No active stylists found!');
    return;
  }
  console.log(`✂️ Found ${stylists.length} active stylists`);

  // Fetch services
  const services = await prisma.service.findMany({
    where: { salonId: salon.id, status: 'ACTIVE' },
  });
  if (services.length === 0) {
    console.error('❌ No active services found!');
    return;
  }
  console.log(`🧴 Found ${services.length} active services`);

  // Target Date: Today (2026-10-22)
  const todayStr = '2026-10-22';
  const targetDateMidnight = new Date(`${todayStr}T00:00:00.000Z`);

  // Helper to ensure customer & salonUser exist
  async function getOrCreateCustomer(name: string, phone: string) {
    let user = await prisma.user.findFirst({ where: { phone } });
    if (!user) {
      user = await prisma.user.create({
        data: { name, phone },
      });
    } else if (user.name !== name) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { name },
      });
    }

    let salonUser = await prisma.salonUser.findFirst({
      where: { salonId: salon!.id, userId: user.id },
    });
    if (!salonUser) {
      salonUser = await prisma.salonUser.create({
        data: { salonId: salon!.id, userId: user.id },
      });
    }
    return salonUser;
  }

  // Find or pick services
  const findService = (query: string) => {
    return services.find(s => s.name.toLowerCase().includes(query.toLowerCase())) || services[0];
  };

  // Find or pick stylists
  const findStylist = (index: number) => {
    return stylists[index % stylists.length];
  };

  // Clean existing today's appointments if any, so we start with a clean slate
  const deletedOld = await prisma.appointment.deleteMany({
    where: {
      salonId: salon.id,
      appointmentDate: targetDateMidnight,
    },
  });
  console.log(`🧹 Cleaned ${deletedOld.count} prior appointments for ${todayStr}`);

  const now = new Date();

  // Define our 10 scenarios
  const scenarios = [
    {
      status: AppointmentStatus.PENDING_ACCEPTANCE,
      customerName: 'Aarav Singhania',
      customerPhone: '+919811223344',
      serviceQuery: 'Haircut',
      addonQueries: ['Beard'],
      stylistIdx: 0,
      startTimeStr: `${todayStr}T11:45:00+05:30`,
      endTimeStr: `${todayStr}T12:30:00+05:30`,
      source: BookingSource.WALK_IN,
      bookingType: BookingType.QUICK,
      price: 550,
      notes: 'Walk-in requested quick haircut + beard grooming via counter QR scan',
    },
    {
      status: AppointmentStatus.BOOKED,
      customerName: 'Ananya Verma',
      customerPhone: '+919876543210',
      serviceQuery: 'Layered Cut',
      stylistIdx: 1,
      startTimeStr: `${todayStr}T15:00:00+05:30`,
      endTimeStr: `${todayStr}T16:00:00+05:30`,
      source: BookingSource.WHATSAPP,
      bookingType: BookingType.NORMAL,
      price: 850,
      notes: 'WhatsApp advance booking. 2-Hour confirmation reminder scheduled.',
    },
    {
      status: AppointmentStatus.CONFIRMED,
      customerName: 'Rohan Sharma',
      customerPhone: '+919822334455',
      serviceQuery: 'Executive',
      stylistIdx: 2,
      startTimeStr: `${todayStr}T13:30:00+05:30`,
      endTimeStr: `${todayStr}T14:15:00+05:30`,
      source: BookingSource.WEB,
      bookingType: BookingType.NORMAL,
      price: 450,
      reminder10mSentAt: new Date(now.getTime() - 3 * 60 * 1000), // Sent 3 mins ago (7 mins left on countdown!)
      notes: 'Confirmed online. Arrival alert dispatched 3 mins ago.',
    },
    {
      status: AppointmentStatus.ON_THE_WAY,
      customerName: 'Simran Kaur',
      customerPhone: '+919833445566',
      serviceQuery: 'Gold Facial',
      stylistIdx: 3,
      startTimeStr: `${todayStr}T12:00:00+05:30`,
      endTimeStr: `${todayStr}T13:00:00+05:30`,
      source: BookingSource.WHATSAPP,
      bookingType: BookingType.NORMAL,
      price: 1500,
      clientEtaStatus: ClientEtaStatus.ON_THE_WAY,
      notes: 'Customer tapped "🚗 On My Way" on WhatsApp arrival prompt',
    },
    {
      status: AppointmentStatus.CHECKED_IN,
      customerName: 'Aakash Patel',
      customerPhone: '+919844556677',
      serviceQuery: 'Beard Grooming',
      stylistIdx: 4,
      startTimeStr: `${todayStr}T11:15:00+05:30`,
      endTimeStr: `${todayStr}T11:45:00+05:30`,
      source: BookingSource.WALK_IN,
      bookingType: BookingType.NORMAL,
      price: 350,
      clientEtaStatus: ClientEtaStatus.ARRIVED,
      notes: 'Arrived at reception, waiting to be seated in chair',
    },
    {
      status: AppointmentStatus.SEATED_IN_CHAIR,
      customerName: 'Pooja Nair',
      customerPhone: '+919855667788',
      serviceQuery: 'Highlights',
      addonQueries: ['Spa'],
      stylistIdx: 5,
      startTimeStr: `${todayStr}T10:45:00+05:30`,
      endTimeStr: `${todayStr}T12:15:00+05:30`,
      source: BookingSource.WEB,
      bookingType: BookingType.NORMAL,
      price: 3200,
      notes: 'Currently in chair undergoing hair styling + hair spa',
    },
    {
      status: AppointmentStatus.PENDING_RESCHEDULE,
      customerName: 'Kavita Rao',
      customerPhone: '+919866778899',
      serviceQuery: 'Keratin',
      stylistIdx: 6,
      startTimeStr: `${todayStr}T16:30:00+05:30`,
      endTimeStr: `${todayStr}T17:45:00+05:30`,
      proposedStartAt: new Date(`${todayStr}T17:00:00+05:30`),
      proposedEndAt: new Date(`${todayStr}T18:15:00+05:30`),
      source: BookingSource.WHATSAPP,
      bookingType: BookingType.NORMAL,
      price: 2100,
      notes: 'Operator proposed 5:00 PM slot. Waiting for client WhatsApp confirmation.',
    },
    {
      status: AppointmentStatus.COMPLETED,
      customerName: 'Sameer Khan',
      customerPhone: '+919877889900',
      serviceQuery: 'Clean Shave',
      stylistIdx: 7,
      startTimeStr: `${todayStr}T09:30:00+05:30`,
      endTimeStr: `${todayStr}T10:00:00+05:30`,
      source: BookingSource.WALK_IN,
      bookingType: BookingType.NORMAL,
      price: 250,
      notes: 'Service successfully completed, client billed.',
    },
    {
      status: AppointmentStatus.CANCELLED,
      customerName: 'Deepak Verma',
      customerPhone: '+919888990011',
      serviceQuery: 'Charcoal Facial',
      stylistIdx: 8,
      startTimeStr: `${todayStr}T10:15:00+05:30`,
      endTimeStr: `${todayStr}T11:00:00+05:30`,
      source: BookingSource.WHATSAPP,
      bookingType: BookingType.NORMAL,
      price: 950,
      cancelledAt: new Date(`${todayStr}T09:45:00+05:30`),
      cancelledBy: CancelledBy.USER,
      cancellationReason: 'Client contacted salon stating urgent family matter. Chair released.',
      notes: 'Cancelled in advance by client.',
    },
    {
      status: AppointmentStatus.REJECTED,
      customerName: 'Ritu Sharma',
      customerPhone: '+919899001122',
      serviceQuery: 'Manicure',
      stylistIdx: 9,
      startTimeStr: `${todayStr}T10:00:00+05:30`,
      endTimeStr: `${todayStr}T10:30:00+05:30`,
      source: BookingSource.QUICK_BOOK,
      bookingType: BookingType.QUICK,
      price: 450,
      cancelledAt: new Date(`${todayStr}T09:55:00+05:30`),
      cancelledBy: CancelledBy.SALON,
      cancellationReason: 'Salon peak hour full capacity; requested stylist unavailable.',
      notes: 'Quick booking declined by front desk.',
    },
  ];

  let count = 0;
  for (const s of scenarios) {
    count++;
    const salonUser = await getOrCreateCustomer(s.customerName, s.customerPhone);
    const service = findService(s.serviceQuery);
    const stylist = findStylist(s.stylistIdx);
    const apptNumber = `APT-TODAY-${1000 + count}`;

    const startAt = new Date(s.startTimeStr);
    const endAt = new Date(s.endTimeStr);
    const durationMinutes = Math.round((endAt.getTime() - startAt.getTime()) / 60000);

    const addonServices = (s.addonQueries || []).map((q: string) => findService(q));
    const allServicesList = [service, ...addonServices];
    const snapshotName = allServicesList.map(sv => sv.name).join(', ');

    const appt = await prisma.appointment.create({
      data: {
        appointmentNumber: apptNumber,
        salonId: salon.id,
        salonUserId: salonUser.id,
        stylistId: stylist.id,
        serviceId: service.id,
        serviceNameSnapshot: snapshotName,
        durationMinutes,
        price: s.price,
        startAt,
        endAt,
        appointmentDate: targetDateMidnight,
        status: s.status,
        source: s.source,
        bookingType: s.bookingType,
        notes: s.notes,
        clientEtaStatus: s.clientEtaStatus,
        reminder10mSentAt: s.reminder10mSentAt,
        proposedStartAt: s.proposedStartAt,
        proposedEndAt: s.proposedEndAt,
        cancelledAt: s.cancelledAt,
        cancelledBy: s.cancelledBy,
        cancellationReason: s.cancellationReason,
      },
    });

    // Create appointment_services entry for primary service + each add-on
    for (let i = 0; i < allServicesList.length; i++) {
      const sv = allServicesList[i];
      await prisma.appointmentService.create({
        data: {
          salonId: salon.id,
          appointmentId: appt.id,
          serviceId: sv.id,
          serviceNameSnapshot: sv.name,
          durationMinutes: sv.durationMinutes || Math.round(durationMinutes / allServicesList.length),
          price: i === 0 ? s.price : sv.price,
          orderIndex: i,
        },
      });
    }

    console.log(`  [${count}/10] Created ${s.status.padEnd(20)} | ${s.customerName.padEnd(18)} | ${snapshotName} (${stylist.name})`);
  }

  console.log(`\n🎉 Successfully seeded all 10 appointment statuses for ${todayStr}!`);
}

main()
  .catch((e) => {
    console.error('❌ Error seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
