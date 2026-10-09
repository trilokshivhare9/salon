const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const SALON_ID = '50ac2818-b36f-4261-abaa-07030d0ab12d';
const STYLIST_VICRAM_ID = 'd8f125fd-bedc-4b4f-b4c7-12deb2506686';
const STYLIST_RAHUL_ID = 'fcaa508a-1070-41be-81c5-d68dc66b6f8d';
const ADMIN_ID = '572963b2-9f60-49aa-abe8-95de651f57e6';
const SERVICE_ID = '3b2618a7-3a7d-4283-9410-34f66a78d5e7';

// Salon Users
const USER_ANANYA_SALON_USER_ID = 'ef789787-1168-4070-b7da-86f353970174';
const USER_RAHUL_SALON_USER_ID = 'c9ffe425-04fd-4b4d-aa75-6c3ea6837d16';
const USER_TRILOK_SALON_USER_ID = 'e4a7feb4-d023-42ca-8f96-9d523bc8bb45';

async function main() {
  console.log('--- Seeding Realistic Leave History Scenarios for Vicram ---');

  // 1. Ensure test appointments exist for reassignment details
  const testAppointments = [
    {
      id: 'a1000000-0000-0000-0000-000000000001',
      appointmentNumber: 'SAL-912840',
      salonId: SALON_ID,
      salonUserId: USER_ANANYA_SALON_USER_ID,
      stylistId: STYLIST_VICRAM_ID,
      serviceId: SERVICE_ID,
      serviceNameSnapshot: 'Hair Styling & Spa',
      durationMinutes: 45,
      price: 350.0,
      startAt: new Date('2026-09-25T11:00:00.000Z'),
      endAt: new Date('2026-09-25T11:45:00.000Z'),
      appointmentDate: new Date('2026-09-25T00:00:00.000Z'),
      status: 'CANCELLED',
      source: 'WHATSAPP',
      notes: 'Customer agreed to reschedule/reassign due to stylist leave',
    },
    {
      id: 'a1000000-0000-0000-0000-000000000002',
      appointmentNumber: 'SAL-438910',
      salonId: SALON_ID,
      salonUserId: USER_RAHUL_SALON_USER_ID,
      stylistId: STYLIST_VICRAM_ID,
      serviceId: SERVICE_ID,
      serviceNameSnapshot: 'Beard Grooming & Styling',
      durationMinutes: 30,
      price: 150.0,
      startAt: new Date('2026-09-29T10:00:00.000Z'),
      endAt: new Date('2026-09-29T10:30:00.000Z'),
      appointmentDate: new Date('2026-09-29T00:00:00.000Z'),
      status: 'CANCELLED',
      source: 'QUICK_BOOK',
      notes: 'No replacement specialist available during emergency morning hours',
    },
    {
      id: 'a1000000-0000-0000-0000-000000000003',
      appointmentNumber: 'SAL-782103',
      salonId: SALON_ID,
      salonUserId: USER_ANANYA_SALON_USER_ID,
      stylistId: STYLIST_VICRAM_ID,
      serviceId: SERVICE_ID,
      serviceNameSnapshot: 'Scalp Treatment & Wash',
      durationMinutes: 40,
      price: 200.0,
      startAt: new Date('2026-10-01T14:30:00.000Z'),
      endAt: new Date('2026-10-01T15:10:00.000Z'),
      appointmentDate: new Date('2026-10-01T00:00:00.000Z'),
      status: 'CANCELLED',
      source: 'WHATSAPP',
      notes: 'Auto-reassigned smoothly to Rahul Sharma',
    },
  ];

  for (const appt of testAppointments) {
    await prisma.appointment.upsert({
      where: { id: appt.id },
      create: appt,
      update: {
        appointmentNumber: appt.appointmentNumber,
        serviceNameSnapshot: appt.serviceNameSnapshot,
        notes: appt.notes,
      },
    });
  }
  console.log('✅ Test appointments prepared.');

  // Clean up any previously seeded mock absences (identified by specific IDs)
  const mockAbsenceIds = [
    'b1000000-0000-0000-0000-000000000001',
    'b1000000-0000-0000-0000-000000000002',
    'b1000000-0000-0000-0000-000000000003',
    'b1000000-0000-0000-0000-000000000004',
    'b1000000-0000-0000-0000-000000000005',
    'b1000000-0000-0000-0000-000000000006',
  ];

  await prisma.bookingReassignment.deleteMany({
    where: { absenceId: { in: mockAbsenceIds } },
  });

  await prisma.stylistAbsence.deleteMany({
    where: { id: { in: mockAbsenceIds } },
  });

  // 2. Define the comprehensive scenarios covering all permutations:
  // Scenario 1: Multi-day Vacation / Casual Leave (ACTIVE, COMPLETED, fully resolved)
  await prisma.stylistAbsence.create({
    data: {
      id: 'b1000000-0000-0000-0000-000000000001',
      salonId: SALON_ID,
      stylistId: STYLIST_VICRAM_ID,
      createdByAdminId: ADMIN_ID,
      startDate: new Date('2026-09-24T00:00:00.000Z'),
      endDate: new Date('2026-09-27T00:00:00.000Z'),
      absenceDate: new Date('2026-09-24T00:00:00.000Z'),
      leaveType: 'CASUAL_LEAVE',
      leavePortion: 'FULL_DAY',
      status: 'ACTIVE',
      processingStatus: 'COMPLETED',
      affectedBookingsCount: 4,
      reassignedCount: 4,
      unresolvableCount: 0,
      reason: 'Vacation',
      notes: 'Annual family holiday trip to Goa. All 4 affected client appointments successfully reassigned.',
      createdAt: new Date('2026-09-23T08:30:00.000Z'),
      reassignments: {
        create: [
          {
            salonId: SALON_ID,
            appointmentId: '6ddda501-14d5-41f2-a40b-0d617a869882',
            originalStylistId: STYLIST_VICRAM_ID,
            newStylistId: STYLIST_RAHUL_ID,
            originalStartAt: new Date('2026-09-24T10:00:00.000Z'),
            originalEndAt: new Date('2026-09-24T10:30:00.000Z'),
            newStartAt: new Date('2026-09-24T10:00:00.000Z'),
            newEndAt: new Date('2026-09-24T10:30:00.000Z'),
            outcome: 'AUTO_ASSIGNED',
            processedAt: new Date('2026-09-23T08:32:00.000Z'),
          },
          {
            salonId: SALON_ID,
            appointmentId: 'a1000000-0000-0000-0000-000000000001',
            originalStylistId: STYLIST_VICRAM_ID,
            newStylistId: STYLIST_RAHUL_ID,
            originalStartAt: new Date('2026-09-25T11:00:00.000Z'),
            originalEndAt: new Date('2026-09-25T11:45:00.000Z'),
            newStartAt: new Date('2026-09-25T11:00:00.000Z'),
            newEndAt: new Date('2026-09-25T11:45:00.000Z'),
            outcome: 'CUSTOMER_ACCEPTED',
            customerResponse: 'ACCEPTED',
            processedAt: new Date('2026-09-23T08:35:00.000Z'),
            customerRespondedAt: new Date('2026-09-23T09:12:00.000Z'),
          },
        ],
      },
    },
  });

  // Scenario 2: Emergency Half-Day Leave with Action Required / Unresolved Conflict (ACTIVE, FAILED)
  await prisma.stylistAbsence.create({
    data: {
      id: 'b1000000-0000-0000-0000-000000000002',
      salonId: SALON_ID,
      stylistId: STYLIST_VICRAM_ID,
      createdByAdminId: ADMIN_ID,
      startDate: new Date('2026-09-29T00:00:00.000Z'),
      endDate: new Date('2026-09-29T00:00:00.000Z'),
      absenceDate: new Date('2026-09-29T00:00:00.000Z'),
      leaveType: 'EMERGENCY_LEAVE',
      leavePortion: 'FIRST_HALF',
      status: 'ACTIVE',
      processingStatus: 'FAILED',
      affectedBookingsCount: 3,
      reassignedCount: 1,
      unresolvableCount: 2,
      reason: 'Family Emergency',
      notes: 'Sudden home emergency in morning. 2 high-value bookings could not be auto-reassigned (stylist capacity exceeded).',
      createdAt: new Date('2026-09-29T04:15:00.000Z'),
      reassignments: {
        create: [
          {
            salonId: SALON_ID,
            appointmentId: '71d77596-4d6b-43fd-a905-f12ec045512c',
            originalStylistId: STYLIST_VICRAM_ID,
            newStylistId: null,
            originalStartAt: new Date('2026-09-29T09:30:00.000Z'),
            originalEndAt: new Date('2026-09-29T10:00:00.000Z'),
            outcome: 'NO_REPLACEMENT',
            processedAt: new Date('2026-09-29T04:18:00.000Z'),
          },
          {
            salonId: SALON_ID,
            appointmentId: 'a1000000-0000-0000-0000-000000000002',
            originalStylistId: STYLIST_VICRAM_ID,
            newStylistId: null,
            originalStartAt: new Date('2026-09-29T10:00:00.000Z'),
            originalEndAt: new Date('2026-09-29T10:30:00.000Z'),
            outcome: 'NO_REPLACEMENT',
            processedAt: new Date('2026-09-29T04:18:00.000Z'),
          },
        ],
      },
    },
  });

  // Scenario 3: Custom Hours Medical Visit (ACTIVE, COMPLETED)
  await prisma.stylistAbsence.create({
    data: {
      id: 'b1000000-0000-0000-0000-000000000003',
      salonId: SALON_ID,
      stylistId: STYLIST_VICRAM_ID,
      createdByAdminId: ADMIN_ID,
      startDate: new Date('2026-10-01T00:00:00.000Z'),
      endDate: new Date('2026-10-01T00:00:00.000Z'),
      absenceDate: new Date('2026-10-01T00:00:00.000Z'),
      leaveType: 'SICK_LEAVE',
      leavePortion: 'CUSTOM_HOURS',
      customStartTime: '14:00',
      customEndTime: '17:00',
      status: 'ACTIVE',
      processingStatus: 'COMPLETED',
      affectedBookingsCount: 1,
      reassignedCount: 1,
      unresolvableCount: 0,
      reason: 'Doctor Appointment',
      notes: 'Dental procedure slot at Max Healthcare. 1 affected appointment successfully reassigned to Rahul Sharma.',
      createdAt: new Date('2026-09-30T16:00:00.000Z'),
      reassignments: {
        create: [
          {
            salonId: SALON_ID,
            appointmentId: 'a1000000-0000-0000-0000-000000000003',
            originalStylistId: STYLIST_VICRAM_ID,
            newStylistId: STYLIST_RAHUL_ID,
            originalStartAt: new Date('2026-10-01T14:30:00.000Z'),
            originalEndAt: new Date('2026-10-01T15:10:00.000Z'),
            newStartAt: new Date('2026-10-01T14:30:00.000Z'),
            newEndAt: new Date('2026-10-01T15:10:00.000Z'),
            outcome: 'AUTO_ASSIGNED',
            processedAt: new Date('2026-09-30T16:02:00.000Z'),
          },
        ],
      },
    },
  });

  // Scenario 4: Cancelled Leave (CANCELLED, COMPLETED)
  await prisma.stylistAbsence.create({
    data: {
      id: 'b1000000-0000-0000-0000-000000000004',
      salonId: SALON_ID,
      stylistId: STYLIST_VICRAM_ID,
      createdByAdminId: ADMIN_ID,
      startDate: new Date('2026-10-03T00:00:00.000Z'),
      endDate: new Date('2026-10-03T00:00:00.000Z'),
      absenceDate: new Date('2026-10-03T00:00:00.000Z'),
      leaveType: 'UNPAID_LEAVE',
      leavePortion: 'SECOND_HALF',
      status: 'CANCELLED',
      processingStatus: 'COMPLETED',
      affectedBookingsCount: 0,
      reassignedCount: 0,
      unresolvableCount: 0,
      reason: 'Personal Errands',
      notes: 'Bank visit cancelled by specialist; returned to salon to cover afternoon rush.',
      createdAt: new Date('2026-10-02T18:00:00.000Z'),
    },
  });

  // Scenario 5: Multi-Day Workshop / Training (ACTIVE)
  await prisma.stylistAbsence.create({
    data: {
      id: 'b1000000-0000-0000-0000-000000000005',
      salonId: SALON_ID,
      stylistId: STYLIST_VICRAM_ID,
      createdByAdminId: ADMIN_ID,
      startDate: new Date('2026-10-04T00:00:00.000Z'),
      endDate: new Date('2026-10-05T00:00:00.000Z'),
      absenceDate: new Date('2026-10-04T00:00:00.000Z'),
      leaveType: 'OTHER',
      leavePortion: 'FULL_DAY',
      status: 'ACTIVE',
      processingStatus: 'COMPLETED',
      affectedBookingsCount: 0,
      reassignedCount: 0,
      unresolvableCount: 0,
      reason: 'Workshop',
      notes: 'Attending L’Oréal Professional Hair Coloring Masterclass certification in Delhi.',
      createdAt: new Date('2026-10-03T11:00:00.000Z'),
    },
  });

  // Scenario 6: Festival Half-Day Leave (ACTIVE)
  await prisma.stylistAbsence.create({
    data: {
      id: 'b1000000-0000-0000-0000-000000000006',
      salonId: SALON_ID,
      stylistId: STYLIST_VICRAM_ID,
      createdByAdminId: ADMIN_ID,
      startDate: new Date('2026-10-08T00:00:00.000Z'),
      endDate: new Date('2026-10-08T00:00:00.000Z'),
      absenceDate: new Date('2026-10-08T00:00:00.000Z'),
      leaveType: 'CASUAL_LEAVE',
      leavePortion: 'SECOND_HALF',
      status: 'ACTIVE',
      processingStatus: 'COMPLETED',
      affectedBookingsCount: 0,
      reassignedCount: 0,
      unresolvableCount: 0,
      reason: 'Festival Eve',
      notes: 'Festival eve afternoon leave marked by salon owner.',
      createdAt: new Date('2026-10-08T06:00:00.000Z'),
    },
  });

  console.log('✅ Successfully seeded all 6 realistic leave scenarios!');
}

main()
  .catch((e) => {
    console.error('❌ Error seeding leave scenarios:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
