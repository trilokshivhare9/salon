import { StylistStatusEngine, StylistOperationalStatus } from '../../../../src/modules/salon-admin/staff/engines/stylist-status.engine';
import { StylistStatus, DayOfWeek, AppointmentStatus, LeavePortion } from '@prisma/client';
import { DateTime } from 'luxon';

describe('StylistStatusEngine', () => {
  let engine: StylistStatusEngine;
  const timezone = 'Asia/Kolkata';

  beforeEach(() => {
    engine = new StylistStatusEngine();
  });

  const baseStylist = {
    id: 'stylist-1',
    name: 'Rahul Sharma',
    status: StylistStatus.ACTIVE,
    followsSalonSchedule: true,
    workingHours: [
      {
        dayOfWeek: DayOfWeek.MONDAY,
        isWorking: true,
        startTime: '10:00',
        endTime: '19:00',
        breaks: [{ startTime: '13:00', endTime: '14:00', name: 'Lunch Break' }],
      },
    ],
  };

  const baseSalonWorkingHours = [
    {
      dayOfWeek: DayOfWeek.MONDAY,
      isClosed: false,
      startTime: '09:00',
      endTime: '21:00',
      breaks: [],
    },
  ];

  it('1. should resolve INACTIVE if stylist status is INACTIVE', () => {
    const inactiveStylist = { ...baseStylist, status: StylistStatus.INACTIVE };
    const evalDt = DateTime.fromISO('2026-10-12T11:00:00', { zone: timezone }); // Monday 11:00 AM

    const res = engine.resolveStylistStatus({
      stylist: inactiveStylist,
      salonWorkingHours: baseSalonWorkingHours,
      evaluationDateTime: evalDt,
      timezone,
    });

    expect(res.status).toBe(StylistOperationalStatus.INACTIVE);
    expect(res.label).toBe('Inactive');
    expect(res.dotClass).toBe('status-inactive');
    expect(res.badgeClass).toBe('badge-inactive');
  });

  it('2. should resolve SALON_OFF if date falls on a store closure or holiday', () => {
    const evalDt = DateTime.fromISO('2026-10-12T11:00:00', { zone: timezone }); // Monday 11:00 AM
    const closures = [
      {
        startDate: new Date('2026-10-12T00:00:00.000Z'),
        endDate: new Date('2026-10-12T23:59:59.000Z'),
        isPartialDay: false,
        reason: 'Diwali Festival',
      },
    ];

    const res = engine.resolveStylistStatus({
      stylist: baseStylist,
      salonWorkingHours: baseSalonWorkingHours,
      salonClosures: closures,
      evaluationDateTime: evalDt,
      timezone,
    });

    expect(res.status).toBe(StylistOperationalStatus.SALON_OFF);
    expect(res.label).toBe('Salon Off');
    expect(res.reason).toBe('Diwali Festival');
    expect(res.dotClass).toBe('status-salon-off');
    expect(res.badgeClass).toBe('badge-salon-off');
  });

  it('3. should resolve WEEKLY_OFF if date is weekly off for the stylist', () => {
    const offStylist = {
      ...baseStylist,
      workingHours: [
        {
          dayOfWeek: DayOfWeek.MONDAY,
          isWorking: false,
          isClosed: true,
        },
      ],
    };
    const evalDt = DateTime.fromISO('2026-10-12T11:00:00', { zone: timezone }); // Monday

    const res = engine.resolveStylistStatus({
      stylist: offStylist,
      salonWorkingHours: baseSalonWorkingHours,
      evaluationDateTime: evalDt,
      timezone,
    });

    expect(res.status).toBe(StylistOperationalStatus.WEEKLY_OFF);
    expect(res.label).toBe('Weekly Off');
    expect(res.reason).toBe('Weekly Off');
  });

  it('4. should resolve ON_LEAVE if stylist has an active approved absence', () => {
    const evalDt = DateTime.fromISO('2026-10-12T11:00:00', { zone: timezone }); // Monday 11:00 AM
    const absences = [
      {
        stylistId: 'stylist-1',
        status: 'ACTIVE',
        startDate: new Date('2026-10-12T00:00:00.000Z'),
        endDate: new Date('2026-10-12T23:59:59.000Z'),
        leavePortion: LeavePortion.FULL_DAY,
        leaveType: 'SICK_LEAVE',
        reason: 'Viral Fever',
      },
    ];

    const res = engine.resolveStylistStatus({
      stylist: baseStylist,
      salonWorkingHours: baseSalonWorkingHours,
      absences,
      evaluationDateTime: evalDt,
      timezone,
    });

    expect(res.status).toBe(StylistOperationalStatus.ON_LEAVE);
    expect(res.label).toBe('On Leave');
    expect(res.reason).toBe('Viral Fever');
    expect(res.dotClass).toBe('status-leave');
    expect(res.badgeClass).toBe('badge-leave');
  });

  it('5. should resolve ON_BREAK if current time is within scheduled lunch/tea break', () => {
    const evalDt = DateTime.fromISO('2026-10-12T13:30:00', { zone: timezone }); // Monday 1:30 PM (Break 13:00 - 14:00)

    const res = engine.resolveStylistStatus({
      stylist: baseStylist,
      salonWorkingHours: baseSalonWorkingHours,
      evaluationDateTime: evalDt,
      timezone,
    });

    expect(res.status).toBe(StylistOperationalStatus.ON_BREAK);
    expect(res.label).toBe('On Break');
    expect(res.dotClass).toBe('status-break');
    expect(res.badgeClass).toBe('badge-break');
    expect(res.reason).toContain('Lunch Break');
  });

  it('6. should resolve WORKING when stylist has a seated in chair appointment', () => {
    const evalDt = DateTime.fromISO('2026-10-12T11:30:00', { zone: timezone }); // Monday 11:30 AM
    const appointments = [
      {
        id: 'appt-123',
        stylistId: 'stylist-1',
        status: AppointmentStatus.SEATED_IN_CHAIR,
        startAt: new Date('2026-10-12T05:30:00.000Z'), // 11:00 AM IST
        endAt: new Date('2026-10-12T06:30:00.000Z'),   // 12:00 PM IST
        serviceNameSnapshot: 'Haircut & Beard Trim',
        salonUser: {
          user: { name: 'Amit Patel' },
        },
      },
    ];

    const res = engine.resolveStylistStatus({
      stylist: baseStylist,
      salonWorkingHours: baseSalonWorkingHours,
      appointments,
      evaluationDateTime: evalDt,
      timezone,
    });

    expect(res.status).toBe(StylistOperationalStatus.WORKING);
    expect(res.label).toBe('In Chair');
    expect(res.dotClass).toBe('status-working');
    expect(res.badgeClass).toBe('badge-working');
    expect(res.reason).toContain('Amit Patel');
    expect(res.metadata?.appointmentId).toBe('appt-123');
  });

  it('7. should resolve AVAILABLE when stylist is on duty, free and ready for clients', () => {
    const evalDt = DateTime.fromISO('2026-10-12T11:30:00', { zone: timezone }); // Monday 11:30 AM, no break, no appt

    const res = engine.resolveStylistStatus({
      stylist: baseStylist,
      salonWorkingHours: baseSalonWorkingHours,
      evaluationDateTime: evalDt,
      timezone,
    });

    expect(res.status).toBe(StylistOperationalStatus.AVAILABLE);
    expect(res.label).toBe('Available');
    expect(res.dotClass).toBe('status-available');
    expect(res.badgeClass).toBe('badge-available');
  });

  it('8. should batch evaluate all salon stylists accurately in resolveBatchStatuses', () => {
    const evalDt = DateTime.fromISO('2026-10-12T11:30:00', { zone: timezone });
    const stylist1 = { ...baseStylist, id: 'st-1', name: 'Stylist 1' };
    const stylist2 = { ...baseStylist, id: 'st-2', name: 'Stylist 2', status: StylistStatus.INACTIVE };

    const batchRes = engine.resolveBatchStatuses({
      stylists: [stylist1, stylist2],
      salonWorkingHours: baseSalonWorkingHours,
      salonClosures: [],
      absences: [],
      appointments: [],
      evaluationDateTime: evalDt,
      timezone,
    });

    expect(batchRes.get('st-1')?.status).toBe(StylistOperationalStatus.AVAILABLE);
    expect(batchRes.get('st-2')?.status).toBe(StylistOperationalStatus.INACTIVE);
  });

  it('9. should attach operational status and customer facing status correctly', () => {
    const statusRes = {
      status: StylistOperationalStatus.AVAILABLE,
      label: 'Available',
      dotClass: 'status-available',
      badgeClass: 'badge-available',
      reason: 'Available for walk-ins and appointments.',
    };

    const stylistWithOp = engine.attachOperationalStatus(baseStylist, statusRes);
    expect(stylistWithOp.operationalStatus).toBe(StylistOperationalStatus.AVAILABLE);
    expect(stylistWithOp.statusLabel).toBe('Available');
    expect(stylistWithOp.statusDotClass).toBe('status-available');

    const stylistWithCustomer = engine.attachCustomerFacingStatus({ ...baseStylist, role: 'Senior Stylist' }, statusRes);
    expect(stylistWithCustomer.operationalStatus).toBe(StylistOperationalStatus.AVAILABLE);
    expect(stylistWithCustomer.customerStatusText).toContain('Senior Stylist');
    expect(stylistWithCustomer.customerStatusText).toContain('Available');
    expect(stylistWithCustomer.isAvailableToday).toBe(true);
  });

  it('10. should query prisma and resolve statuses in resolveSalonStaffStatuses', async () => {
    const mockPrisma: any = {
      salon: {
        findUnique: jest.fn().mockResolvedValue({ timezone: 'Asia/Kolkata' }),
      },
      salonWorkingHours: {
        findMany: jest.fn().mockResolvedValue(baseSalonWorkingHours),
      },
      salonClosure: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      stylistAbsence: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      appointment: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    const engineWithPrisma = new StylistStatusEngine(mockPrisma);
    const result = await engineWithPrisma.resolveSalonStaffStatuses('salon-1', {
      targetDate: '2026-10-12T11:00:00',
      stylists: [baseStylist],
    });

    expect(result).toBeDefined();
    expect(result.get('stylist-1')?.status).toBe(StylistOperationalStatus.AVAILABLE);
    expect(mockPrisma.salonWorkingHours.findMany).toHaveBeenCalledWith({ where: { salonId: 'salon-1' } });
  });
});
