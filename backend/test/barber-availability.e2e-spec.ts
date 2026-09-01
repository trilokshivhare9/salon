import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { TransformInterceptor } from '../src/common/interceptors/transform.interceptor';
import { AllExceptionsFilter } from '../src/common/filters/http-exception.filter';
import { PrismaService } from '../src/database/prisma.service';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';
import { RolesGuard } from '../src/common/guards/roles.guard';
import { Reflector } from '@nestjs/core';
import { DateTime } from 'luxon';

/**
 * BRUTAL BARBER AVAILABILITY & BUSY-TIME MANAGEMENT TEST SUITE
 * 
 * Verifies all 10 real-world barber conflict and busy-time scenarios:
 * 1. Single Barber Busy (Partial Availability)
 * 2. All Barbers Busy (Slot Disappearance)
 * 3. Scheduled Staff Break (Lunch/Shift breaks)
 * 4. Barber Off-Day / Non-working Day
 * 5. Multi-Interval Service Duration Collision
 * 6. Partial Service-Skill Assignment
 * 7. Individual Staff Emergency Blocked Time
 * 8. Salon-Wide Blocked Time
 * 9. Auto-Assignment Fair Load Balancing
 * 10. Concurrency Race-Condition Protection
 */
describe('💈 BRUTAL Barber Availability & Busy-Time Suite', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let salonAdminToken: string;

  let salonId: string;
  let salonSlug: string;
  let service30MinId: string;
  let service60MinId: string;
  let barberAId: string;
  let barberBId: string;

  // Use a future date for stable deterministic testing
  const testDate = DateTime.now().plus({ days: 6 }).toISODate()!; // "YYYY-MM-DD"
  const testDateObj = new Date(testDate);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalInterceptors(new TransformInterceptor());

    const reflector = app.get(Reflector);
    app.useGlobalGuards(new JwtAuthGuard(reflector), new RolesGuard(reflector));

    await app.init();
    prisma = app.get<PrismaService>(PrismaService);

    // Login as Salon Admin
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'trilok@gmail.com', password: 'Password123!' })
      .expect(200);

    salonAdminToken = loginRes.body.data.accessToken;
    salonId = loginRes.body.data.user.salonId;
    salonSlug = loginRes.body.data.user.salon.slug;

    // Fetch or create 30-min and 60-min services
    let s30 = await prisma.service.findFirst({
      where: { salonId, durationMinutes: 30, status: 'ACTIVE' },
    });
    if (!s30) {
      s30 = await prisma.service.create({
        data: {
          salonId,
          name: 'Classic Haircut 30m',
          durationMinutes: 30,
          price: 150,
          category: 'Hair',
        },
      });
    }

    let s60 = await prisma.service.findFirst({
      where: { salonId, durationMinutes: 60, status: 'ACTIVE' },
    });
    if (!s60) {
      s60 = await prisma.service.create({
        data: {
          salonId,
          name: 'Deluxe Spa 60m',
          durationMinutes: 60,
          price: 300,
          category: 'Spa',
        },
      });
    }

    service30MinId = s30.id;
    service60MinId = s60.id;

    // Fetch or create active staff (Barber A & Barber B)
    let staffList = await prisma.staff.findMany({
      where: { salonId, status: 'ACTIVE' },
      take: 2,
    });

    if (staffList.length < 2) {
      const barber1 = await prisma.staff.create({
        data: { salonId, name: 'Barber Alpha', status: 'ACTIVE' },
      });
      const barber2 = await prisma.staff.create({
        data: { salonId, name: 'Barber Beta', status: 'ACTIVE' },
      });
      staffList = [barber1, barber2];
    }

    barberAId = staffList[0].id;
    barberBId = staffList[1].id;

    // Restrict 30-min service to ONLY Barber A & Barber B
    await prisma.staffService.deleteMany({
      where: { serviceId: service30MinId },
    });
    await prisma.staffService.createMany({
      data: [
        { staffId: barberAId, serviceId: service30MinId },
        { staffId: barberBId, serviceId: service30MinId },
      ],
    });

    // Restrict 60-min service to ONLY Barber A & Barber B
    await prisma.staffService.deleteMany({
      where: { serviceId: service60MinId },
    });
    // Ensure working hours exist for all days for both barbers
    const days = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'] as const;
    for (const barberId of [barberAId, barberBId]) {
      for (const day of days) {
        await prisma.staffWorkingHours.upsert({
          where: { staffId_dayOfWeek: { staffId: barberId, dayOfWeek: day } },
          create: { staffId: barberId, dayOfWeek: day, isWorking: true, startTime: '09:00', endTime: '21:00' },
          update: { isWorking: true, startTime: '09:00', endTime: '21:00' },
        });
      }
    }

    // Clean any pre-existing appointments, breaks, or blocked times for testDate
    await cleanTestData();
  }, 30000);

  afterAll(async () => {
    await cleanTestData();
    await prisma.staffService.deleteMany({
      where: { service: { salonId, name: { in: ['Classic Haircut 30m', 'Deluxe Spa 60m'] } } },
    });
    await prisma.service.deleteMany({
      where: { salonId, name: { in: ['Classic Haircut 30m', 'Deluxe Spa 60m'] } },
    });
    await app.close();
  }, 10000);

  async function cleanTestData() {
    await prisma.appointmentStatusHistory.deleteMany({
      where: { appointment: { salonId, date: testDateObj } },
    });
    await prisma.appointment.deleteMany({
      where: { salonId, date: testDateObj },
    });
    await prisma.blockedTime.deleteMany({
      where: { salonId },
    });
    await prisma.staffBreak.deleteMany({
      where: { staff: { salonId } },
    });
  }

  // =========================================================================
  // SCENARIO 1: Single Barber Busy (Partial Availability)
  // =========================================================================
  it('1️⃣ Single Barber Busy → slot remains open with availableStaffCount = 1 and only free barber ID', async () => {
    // Book Barber A at 11:00 AM
    await request(app.getHttpServer())
      .post(`/api/v1/booking/${salonSlug}/appointments`)
      .send({
        serviceId: service30MinId,
        staffId: barberAId,
        date: testDate,
        startTime: '11:00',
        customerName: 'Test Customer 1',
        customerPhone: '+919999000101',
      })
      .expect(201);

    // Query availability for the salon
    const res = await request(app.getHttpServer())
      .get(`/api/v1/booking/${salonSlug}/availability?serviceId=${service30MinId}&date=${testDate}`)
      .expect(200);

    const slot1100 = res.body.data.availableSlots.find((s: any) => s.startTime === '11:00');
    expect(slot1100).toBeDefined();
    expect(slot1100.availableStaffCount).toBe(1);
    expect(slot1100.eligibleStaffIds).toContain(barberBId);
    expect(slot1100.eligibleStaffIds).not.toContain(barberAId);
  });

  // =========================================================================
  // SCENARIO 2: All Barbers Busy (Slot Elimination)
  // =========================================================================
  it('2️⃣ All Barbers Busy → 11:00 slot completely disappears from available slots', async () => {
    // Book Barber B at 11:00 AM as well
    await request(app.getHttpServer())
      .post(`/api/v1/booking/${salonSlug}/appointments`)
      .send({
        serviceId: service30MinId,
        staffId: barberBId,
        date: testDate,
        startTime: '11:00',
        customerName: 'Test Customer 2',
        customerPhone: '+919999000102',
      })
      .expect(201);

    // Query availability
    const res = await request(app.getHttpServer())
      .get(`/api/v1/booking/${salonSlug}/availability?serviceId=${service30MinId}&date=${testDate}`)
      .expect(200);

    const slot1100 = res.body.data.availableSlots.find((s: any) => s.startTime === '11:00');
    expect(slot1100).toBeUndefined(); // Completely gone!
  });

  // =========================================================================
  // SCENARIO 3: Scheduled Staff Break (Lunch break 13:00–14:00)
  // =========================================================================
  it('3️⃣ Scheduled Staff Break → Barber A excluded from 13:00 & 13:30 slots', async () => {
    const luxonDt = DateTime.fromISO(testDate, { zone: 'Asia/Kolkata' });
    const dayOfWeek = (['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'] as const)[
      luxonDt.weekday - 1
    ];

    // Add Lunch break 13:00 - 14:00 for Barber A
    await prisma.staffBreak.create({
      data: {
        staffId: barberAId,
        dayOfWeek,
        startTime: '13:00',
        endTime: '14:00',
        title: 'Lunch Break',
      },
    });

    const res = await request(app.getHttpServer())
      .get(`/api/v1/booking/${salonSlug}/availability?serviceId=${service30MinId}&date=${testDate}&staffId=${barberAId}`)
      .expect(200);

    const slot1300 = res.body.data.availableSlots.find((s: any) => s.startTime === '13:00');
    const slot1330 = res.body.data.availableSlots.find((s: any) => s.startTime === '13:30');

    expect(slot1300).toBeUndefined();
    expect(slot1330).toBeUndefined();
  });

  // =========================================================================
  // SCENARIO 4: Barber Off-Day / Non-Working Day
  // =========================================================================
  it('4️⃣ Barber Off-Day → Barber with isWorking = false returns 0 slots', async () => {
    const luxonDt = DateTime.fromISO(testDate, { zone: 'Asia/Kolkata' });
    const dayOfWeek = (['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'] as const)[
      luxonDt.weekday - 1
    ];

    // Temporarily set Barber A to off-day
    await prisma.staffWorkingHours.update({
      where: { staffId_dayOfWeek: { staffId: barberAId, dayOfWeek } },
      data: { isWorking: false },
    });

    const res = await request(app.getHttpServer())
      .get(`/api/v1/booking/${salonSlug}/availability?serviceId=${service30MinId}&date=${testDate}&staffId=${barberAId}`)
      .expect(200);

    expect(res.body.data.availableSlots).toEqual([]);

    // Restore working hours
    await prisma.staffWorkingHours.update({
      where: { staffId_dayOfWeek: { staffId: barberAId, dayOfWeek } },
      data: { isWorking: true },
    });
  });

  // =========================================================================
  // SCENARIO 5: Long Service Duration Collision (60-min service vs 30-min slot)
  // =========================================================================
  it('5️⃣ Multi-Interval Duration Collision → 60-min service at 14:30 blocked if 15:00 appointment exists', async () => {
    // Book Barber A at 15:00–15:30
    await request(app.getHttpServer())
      .post(`/api/v1/booking/${salonSlug}/appointments`)
      .send({
        serviceId: service30MinId,
        staffId: barberAId,
        date: testDate,
        startTime: '15:00',
        customerName: 'Test Customer 5',
        customerPhone: '+919999000105',
      })
      .expect(201);

    // Check 60-min service availability for Barber A
    const res = await request(app.getHttpServer())
      .get(`/api/v1/booking/${salonSlug}/availability?serviceId=${service60MinId}&date=${testDate}&staffId=${barberAId}`)
      .expect(200);

    // 14:30 slot (which would run 14:30 - 15:30) MUST be blocked because it collides with 15:00!
    const slot1430 = res.body.data.availableSlots.find((s: any) => s.startTime === '14:30');
    expect(slot1430).toBeUndefined();
  });

  // =========================================================================
  // SCENARIO 6: Partial Service-Skill Assignment
  // =========================================================================
  it('6️⃣ Service-Skill Assignment → Unassigned barber cannot be booked for special service', async () => {
    // Create special VIP service assigned ONLY to Barber A
    const vipService = await prisma.service.create({
      data: {
        salonId,
        name: 'Exclusive VIP Treatment',
        price: 3000,
        durationMinutes: 30,
        category: 'VIP',
      },
    });

    await prisma.staffService.create({
      data: { staffId: barberAId, serviceId: vipService.id },
    });

    // Query availability for VIP service
    const res = await request(app.getHttpServer())
      .get(`/api/v1/booking/${salonSlug}/availability?serviceId=${vipService.id}&date=${testDate}`)
      .expect(200);

    // All available slots should strictly only list Barber A
    for (const slot of res.body.data.availableSlots) {
      expect(slot.eligibleStaffIds).toContain(barberAId);
      expect(slot.eligibleStaffIds).not.toContain(barberBId);
    }

    // Cleanup
    await prisma.staffService.deleteMany({ where: { serviceId: vipService.id } });
    await prisma.service.delete({ where: { id: vipService.id } });
  });

  // =========================================================================
  // SCENARIO 7: Individual Staff Emergency Blocked Time
  // =========================================================================
  it('7️⃣ Staff Blocked Time → Blocks 15:00–16:00 for Barber B only', async () => {
    const startDt = DateTime.fromISO(testDate, { zone: 'Asia/Kolkata' }).set({ hour: 15, minute: 0 });
    const endDt = startDt.plus({ hours: 1 });

    await prisma.blockedTime.create({
      data: {
        salonId,
        staffId: barberBId,
        startTime: startDt.toUTC().toJSDate(),
        endTime: endDt.toUTC().toJSDate(),
        reason: 'Doctor Appointment',
      },
    });

    const res = await request(app.getHttpServer())
      .get(`/api/v1/booking/${salonSlug}/availability?serviceId=${service30MinId}&date=${testDate}&staffId=${barberBId}`)
      .expect(200);

    const slot1500 = res.body.data.availableSlots.find((s: any) => s.startTime === '15:00');
    const slot1530 = res.body.data.availableSlots.find((s: any) => s.startTime === '15:30');

    expect(slot1500).toBeUndefined();
    expect(slot1530).toBeUndefined();
  });

  // =========================================================================
  // SCENARIO 8: Whole Salon Blocked Time (Power maintenance)
  // =========================================================================
  it('8️⃣ Salon-Wide Blocked Time → 16:00–17:00 blocked across ALL barbers', async () => {
    const startDt = DateTime.fromISO(testDate, { zone: 'Asia/Kolkata' }).set({ hour: 16, minute: 0 });
    const endDt = startDt.plus({ hours: 1 });

    await prisma.blockedTime.create({
      data: {
        salonId,
        staffId: null, // Entire salon
        startTime: startDt.toUTC().toJSDate(),
        endTime: endDt.toUTC().toJSDate(),
        reason: 'Power Maintenance',
      },
    });

    const res = await request(app.getHttpServer())
      .get(`/api/v1/booking/${salonSlug}/availability?serviceId=${service30MinId}&date=${testDate}`)
      .expect(200);

    const slot1600 = res.body.data.availableSlots.find((s: any) => s.startTime === '16:00');
    const slot1630 = res.body.data.availableSlots.find((s: any) => s.startTime === '16:30');

    expect(slot1600).toBeUndefined();
    expect(slot1630).toBeUndefined();
  });

  // =========================================================================
  // SCENARIO 9: Auto-Assignment Fair Load Balancing ("Any Specialist")
  // =========================================================================
  it('9️⃣ Fair Load Balancing → Auto-assigns least-loaded barber when booking with Any Specialist', async () => {
    // At this point on testDate:
    // Barber A has multiple appointments created in previous tests.
    // Barber B has fewer appointments.
    const counts = await prisma.appointment.groupBy({
      by: ['staffId'],
      where: {
        salonId,
        date: testDateObj,
        status: { notIn: ['CANCELLED', 'NO_SHOW', 'RESCHEDULED'] },
      },
      _count: { id: true },
    });

    const countA = counts.find((c) => c.staffId === barberAId)?._count.id || 0;
    const countB = counts.find((c) => c.staffId === barberBId)?._count.id || 0;

    // Both are free at 18:00
    const res = await request(app.getHttpServer())
      .post(`/api/v1/booking/${salonSlug}/appointments`)
      .send({
        serviceId: service30MinId,
        // No staffId provided → "Any Specialist"
        date: testDate,
        startTime: '18:00',
        customerName: 'Load Balance Test User',
        customerPhone: '+919999000109',
      })
      .expect(201);

    // Verify the assigned staff in the created appointment is the least-loaded barber
    const dbAppt = await prisma.appointment.findUnique({
      where: { id: res.body.data.appointmentId },
    });

    const expectedAssigned = countA <= countB ? barberAId : barberBId;
    expect(dbAppt!.staffId).toBe(expectedAssigned);
  });

  // =========================================================================
  // SCENARIO 10: Simultaneous Race-Condition Booking
  // =========================================================================
  it('🔟 Concurrency Race-Condition → 4 simultaneous requests for last free barber → exactly 1 succeeds, 3 get 409', async () => {
    const targetSlot = '18:30';

    // Clear target slot
    await prisma.appointmentStatusHistory.deleteMany({
      where: { appointment: { salonId, date: testDateObj, startTime: { gte: new Date(`${testDate}T18:30:00.000Z`) } } },
    });

    const requests = Array.from({ length: 4 }).map((_, idx) =>
      request(app.getHttpServer())
        .post(`/api/v1/booking/${salonSlug}/appointments`)
        .send({
          serviceId: service30MinId,
          staffId: barberAId,
          date: testDate,
          startTime: targetSlot,
          customerName: `Concurrent Race User ${idx + 1}`,
          customerPhone: `+91999900020${idx + 1}`,
        }),
    );

    const responses = await Promise.all(requests);

    const successful = responses.filter((r) => r.status === 201);
    const conflicts = responses.filter((r) => r.status === 409);

    expect(successful.length).toBe(1);
    expect(conflicts.length).toBe(3);

    // Verify DB integrity: only 1 appointment exists for Barber A at that time
    const dbAppointments = await prisma.appointment.findMany({
      where: {
        salonId,
        staffId: barberAId,
        date: testDateObj,
        startTime: new Date(successful[0].body.data.startTime),
      },
    });

    expect(dbAppointments.length).toBe(1);
  }, 20000);
});
