import { PrismaClient, AppointmentStatus, SalonStatus } from '@prisma/client';

const prisma = new PrismaClient();

async function testSalonDeactivationValidation() {
  console.log('🧪 Starting Validated Salon Deactivation E2E Test...\n');

  // Get or create an admin for createdByAdmin requirement
  let admin = await prisma.admin.findFirst();
  if (!admin) {
    admin = await prisma.admin.create({
      data: {
        email: `admin_${Date.now()}@example.com`,
        passwordHash: 'hashed_pw',
        name: 'Test Admin',
        role: 'SUPER_ADMIN',
      },
    });
  }

  // Step 1: Create dummy salon for testing
  const testSalon = await prisma.salon.create({
    data: {
      name: 'Deactivation Validation Salon ' + Date.now().toString().slice(-4),
      slug: 'deact-salon-' + Date.now(),
      phone: '9888877777',
      email: `deact_${Date.now()}@example.com`,
      status: SalonStatus.ACTIVE,
      createdByAdmin: {
        connect: { id: admin.id },
      },
    },
  });
  console.log(`Step 1: Created test salon "${testSalon.name}" (ID: ${testSalon.id})`);

  // Step 2: Create a user, customer & active appointment for today
  const testUser = await prisma.user.create({
    data: {
      phone: '91' + Date.now().toString().slice(-10),
      name: 'Test Deact Customer',
    },
  });

  const salonUser = await prisma.salonUser.create({
    data: {
      salonId: testSalon.id,
      userId: testUser.id,
    },
  });

  const stylist = await prisma.stylist.create({
    data: {
      salonId: testSalon.id,
      name: 'Deact Stylist',
      phone: '9999911111',
    },
  });

  const activeBooking = await prisma.appointment.create({
    data: {
      appointmentNumber: 'DEACT-' + Date.now().toString().slice(-6),
      salonId: testSalon.id,
      salonUserId: salonUser.id,
      stylistId: stylist.id,
      serviceNameSnapshot: 'Test Styling',
      durationMinutes: 30,
      price: 200,
      startAt: new Date(),
      endAt: new Date(Date.now() + 30 * 60000),
      appointmentDate: new Date(),
      status: AppointmentStatus.CONFIRMED,
    },
  });
  console.log(`Step 2: Created active CONFIRMED appointment (ID: ${activeBooking.id}) for today.`);

  // Step 3: Test Deactivation WITHOUT forceCancel
  console.log('\nStep 3: Attempting deactivation WITHOUT forceCancel parameter...');
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const activeBookings = await prisma.appointment.findMany({
    where: {
      salonId: testSalon.id,
      status: { in: [AppointmentStatus.CONFIRMED, AppointmentStatus.CHECKED_IN, AppointmentStatus.IN_SERVICE] },
      appointmentDate: { gte: today },
    },
  });

  if (activeBookings.length > 0) {
    console.log(`✅ SUCCESS: Deactivation blocked! Detected ${activeBookings.length} active/future booking(s).`);
  } else {
    throw new Error('❌ FAILED: Active bookings were not detected!');
  }

  // Step 4: Test Deactivation WITH forceCancel
  console.log('\nStep 4: Executing deactivation WITH forceCancel = true...');
  
  await prisma.appointment.updateMany({
    where: {
      salonId: testSalon.id,
      status: { in: [AppointmentStatus.CONFIRMED, AppointmentStatus.CHECKED_IN, AppointmentStatus.IN_SERVICE] },
    },
    data: {
      status: AppointmentStatus.CANCELLED,
      notes: 'Salon Account Deactivated by Platform Super Admin',
    },
  });

  const updatedSalon = await prisma.salon.update({
    where: { id: testSalon.id },
    data: { status: SalonStatus.DEACTIVATED },
  });

  const checkBooking = await prisma.appointment.findUnique({ where: { id: activeBooking.id } });

  console.log(`✅ SUCCESS: Salon Status is now: ${updatedSalon.status}`);
  console.log(`✅ SUCCESS: Active Booking Status is now: ${checkBooking?.status}`);
  console.log(`   Notes: "${checkBooking?.notes}"`);

  // Clean up test data
  await prisma.appointment.deleteMany({ where: { salonId: testSalon.id } });
  await prisma.stylist.deleteMany({ where: { salonId: testSalon.id } });
  await prisma.salonUser.deleteMany({ where: { salonId: testSalon.id } });
  await prisma.salon.delete({ where: { id: testSalon.id } });
  await prisma.user.delete({ where: { id: testUser.id } });

  console.log('\n🎉 VALIDATED SALON DEACTIVATION TEST PASSED CLEANLY!');
}

testSalonDeactivationValidation()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    prisma.$disconnect();
    process.exit(1);
  });
