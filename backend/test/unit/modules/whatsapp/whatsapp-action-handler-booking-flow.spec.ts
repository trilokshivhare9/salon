import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../../src/database/prisma.service';
import { WhatsAppService } from '../../../../src/modules/channels/whatsapp/whatsapp.service';
import { AppointmentsService } from '../../../../src/modules/salon-admin/appointments/appointments.service';
import { AvailabilityService } from '../../../../src/modules/salon-admin/availability/availability.service';
import { CancellationService } from '../../../../src/modules/salon-admin/appointments/cancellation/cancellation.service';
import { RescheduleService } from '../../../../src/modules/salon-admin/appointments/reschedule/reschedule.service';
import { ConfigService } from '@nestjs/config';
import { ConversationState, ServiceGender, AppointmentStatus, ClientEtaStatus } from '@prisma/client';
import { QuickCodeService } from '../../../../src/modules/salon-admin/quick-booking/quick-code.service';
import { WhatsAppButtonId } from '../../../../src/modules/channels/whatsapp/services/whatsapp-sender.service';
import { DateTime } from 'luxon';

describe('WhatsApp Action Handler - Real Availability & Booking Journey', () => {
  let whatsAppService: WhatsAppService;
  let prisma: PrismaService;
  let availabilityService: AvailabilityService;
  let appointmentsService: AppointmentsService;
  let rescheduleService: RescheduleService;
  let cancellationService: CancellationService;

  const testSalonId = 'salon-test-123';
  const customerPhone = '919876543210';

  const mockSalon = {
    id: testSalonId,
    name: 'Luxury Salon',
    phone: '+919876543210',
    address: '123 Main St',
    status: 'ACTIVE',
    timezone: 'Asia/Kolkata',
    cancelWindowHours: 2,
    serviceCategories: [
      { id: 'cat-hair', name: 'Hair Care', sortOrder: 1 },
      { id: 'cat-spa', name: 'Spa & Wellness', sortOrder: 2 },
    ],
    services: [
      {
        id: 'svc-haircut',
        name: 'Men Haircut',
        serviceCategoryId: 'cat-hair',
        price: 500,
        durationMinutes: 30,
        gender: ServiceGender.MALE,
        status: 'ACTIVE',
      },
      {
        id: 'svc-spa',
        name: 'Head Spa',
        serviceCategoryId: 'cat-spa',
        price: 1200,
        durationMinutes: 45,
        gender: ServiceGender.UNISEX,
        status: 'ACTIVE',
      },
    ],
    stylists: [
      {
        id: 'stylist-alice',
        name: 'Alice',
        role: 'Master Stylist',
        status: 'ACTIVE',
        services: [{ serviceId: 'svc-haircut' }, { serviceId: 'svc-spa' }],
      },
      {
        id: 'stylist-bob',
        name: 'Bob',
        role: 'Spa Specialist',
        status: 'ACTIVE',
        services: [{ serviceId: 'svc-spa' }], // NOT qualified for haircut
      },
    ],
  };

  let mockConversation: any = {
    id: 'conv-test-1',
    salonId: testSalonId,
    customerPhone,
    state: ConversationState.START,
    selectedCategoryId: null,
    selectedServiceId: null,
    selectedStaffId: null,
    selectedDate: null,
    selectedStartTime: null,
    tempBookingGender: null,
    activeAppointmentId: null,
  };

  const mockUser = {
    id: 'user-test-1',
    phone: customerPhone,
    name: 'John Doe',
  };

  beforeEach(async () => {
    mockConversation = {
      id: 'conv-test-1',
      salonId: testSalonId,
      customerPhone,
      state: ConversationState.START,
      selectedCategoryId: null,
      selectedServiceId: null,
      selectedStaffId: null,
      selectedDate: null,
      selectedStartTime: null,
      tempBookingGender: null,
      activeAppointmentId: null,
    };

    const mockPrisma: any = {
      salon: {
        findUnique: jest.fn().mockResolvedValue(mockSalon),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue(mockUser),
        create: jest.fn().mockResolvedValue(mockUser),
      },
      salonUser: {
        upsert: jest.fn().mockResolvedValue({ isBookingBlocked: false, userId: mockUser.id }),
      },
      conversation: {
        findUnique: jest.fn().mockImplementation(() => Promise.resolve(mockConversation)),
        upsert: jest.fn().mockImplementation((args) => {
          mockConversation = { ...mockConversation, ...args.create, ...args.update };
          return Promise.resolve(mockConversation);
        }),
        update: jest.fn().mockImplementation((args) => {
          mockConversation = { ...mockConversation, ...args.data };
          return Promise.resolve(mockConversation);
        }),
      },
      appointment: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue(true),
      },
      whatsAppAccount: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      whatsAppLog: {
        create: jest.fn().mockResolvedValue(true),
      },
    };

    const mockAvailabilityService: any = {
      getQualifiedStylists: jest.fn().mockImplementation((salonId: string, serviceIdOrIds: string | string[]) => {
        const sIds = Array.isArray(serviceIdOrIds) ? serviceIdOrIds : [serviceIdOrIds];
        return Promise.resolve(
          mockSalon.stylists.filter((st: any) =>
            st.status === 'ACTIVE' && sIds.every((sId) => st.services?.some((s: any) => s.serviceId === sId)),
          ),
        );
      }),
      findAvailableDates: jest.fn().mockResolvedValue([
        { dateStr: '2026-09-29', displayLabel: 'Tomorrow' },
        { dateStr: '2026-09-30', displayLabel: 'Wed, Sep 30' },
      ]),
      getAvailableSlots: jest.fn().mockResolvedValue({
        date: '2026-09-29',
        salonTimezone: 'Asia/Kolkata',
        serviceDurationMinutes: 30,
        status: 'AVAILABLE',
        statusReason: 'Slots available',
        availableSlots: [
          {
            startTime: '10:00',
            endTime: '10:30',
            isoStartTime: '2026-09-29T04:30:00.000Z',
            isoEndTime: '2026-09-29T05:00:00.000Z',
            availableStaffCount: 1,
            eligibleStaffIds: ['stylist-alice'],
          },
          {
            startTime: '11:00',
            endTime: '11:30',
            isoStartTime: '2026-09-29T05:30:00.000Z',
            isoEndTime: '2026-09-29T06:00:00.000Z',
            availableStaffCount: 1,
            eligibleStaffIds: ['stylist-alice'],
          },
        ],
      }),
      findEarliestAvailableSlotToday: jest.fn().mockResolvedValue({
        dateStr: '2026-09-28',
        startTime: '11:00',
        displayTime: '11:00 AM',
        availableStaffCount: 1,
        eligibleStaffIds: ['stylist-alice'],
      }),
    };

    const mockAppointmentsService: any = {
      createAppointment: jest.fn().mockResolvedValue({
        id: 'appt-new-1',
        appointmentNumber: 'APT-1001',
        startTime: '2026-09-29T10:00:00.000Z',
        startAt: new Date('2026-09-29T10:00:00.000Z'),
        price: 500,
        service: { name: 'Men Haircut' },
        stylist: { name: 'Alice' },
      }),
      updateStatus: jest.fn().mockResolvedValue(true),
      updateEtaStatus: jest.fn().mockResolvedValue(true),
    };

    const mockCancellationService: any = {
      cancelBooking: jest.fn().mockResolvedValue(true),
      checkCancellationPenalty: jest.fn().mockResolvedValue({
        willIncurPenalty: false,
        hoursUntil: 5,
        cancelWindowHours: 2,
        apptStart: new Date(Date.now() + 5 * 3600 * 1000),
      }),
    };

    const mockRescheduleService: any = {
      rescheduleAppointment: jest.fn().mockResolvedValue(true),
      validateRescheduleEligibility: jest.fn().mockResolvedValue({
        allowed: true,
        hoursUntil: 5,
        cancelWindowHours: 2,
      }),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        WhatsAppService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: AvailabilityService, useValue: mockAvailabilityService },
        { provide: AppointmentsService, useValue: mockAppointmentsService },
        { provide: CancellationService, useValue: mockCancellationService },
        { provide: RescheduleService, useValue: mockRescheduleService },
        { provide: QuickCodeService, useValue: { verifyCode: jest.fn(), getOrCreateTodayCode: jest.fn() } },
      ],
    }).compile();

    whatsAppService = moduleRef.get<WhatsAppService>(WhatsAppService);
    prisma = moduleRef.get<PrismaService>(PrismaService);
    availabilityService = moduleRef.get<AvailabilityService>(AvailabilityService);
    appointmentsService = moduleRef.get<AppointmentsService>(AppointmentsService);
    rescheduleService = moduleRef.get<RescheduleService>(RescheduleService);
    cancellationService = moduleRef.get<CancellationService>(CancellationService);

    jest.spyOn(whatsAppService, 'sendMetaMessage').mockImplementation(async () => true as any);
  });

  // ---------------------------------------------------------------------------
  // 1. Gender Selection & Category Filtering
  // ---------------------------------------------------------------------------
  it('TC-FLOW-001: Gender selection filters service categories accordingly', async () => {
    mockConversation.state = ConversationState.SELECT_CATEGORY;
    const sendSpy = jest.spyOn(whatsAppService, 'sendMetaMessage');
    sendSpy.mockClear();

    const result = await whatsAppService.handleIncomingMessage(
      testSalonId,
      customerPhone,
      'gender_select_MALE',
      'gender_select_MALE',
    );

    expect(result.state).toBe(ConversationState.SELECT_CATEGORY);
    expect(sendSpy).toHaveBeenCalled();
    const payload = sendSpy.mock.calls[0][1];
    expect(payload.interactiveType).toBe('list');
    // Categories matching MALE or UNISEX
    expect(payload.listRows.some((r: any) => r.id === 'cat_cat-hair')).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // 2. Service Selection & Qualified Specialist Filtering
  // ---------------------------------------------------------------------------
  it('TC-FLOW-002: Service selection only shows stylists qualified for that specific service', async () => {
    mockConversation.state = ConversationState.SELECT_SERVICE;
    const sendSpy = jest.spyOn(whatsAppService, 'sendMetaMessage');
    sendSpy.mockClear();

    // User chooses 'svc-haircut'. Only Alice is qualified, Bob is NOT qualified.
    const result = await whatsAppService.handleIncomingMessage(
      testSalonId,
      customerPhone,
      'svc_svc-haircut',
      'svc_svc-haircut',
    );

    expect(result.state).toBe(ConversationState.SELECT_STAFF);
    expect(sendSpy).toHaveBeenCalled();
    const payload = sendSpy.mock.calls[0][1];
    expect(payload.interactiveType).toBe('list');

    const stylistRowIds = payload.listRows.map((r: any) => r.id);
    expect(stylistRowIds).toContain(WhatsAppButtonId.STAFF_ANY);
    expect(stylistRowIds).toContain('staff_stylist-alice');
    expect(stylistRowIds).not.toContain('staff_stylist-bob'); // Bob must NOT be shown!
  });

  // ---------------------------------------------------------------------------
  // 3. Staff Selection & Real Dynamic Date Scanning
  // ---------------------------------------------------------------------------
  it('TC-FLOW-003: Staff selection queries AvailabilityService across dates and offers bookable dates', async () => {
    mockConversation.state = ConversationState.SELECT_STAFF;
    mockConversation.selectedServiceId = 'svc-haircut';
    const sendSpy = jest.spyOn(whatsAppService, 'sendMetaMessage');
    sendSpy.mockClear();

    const result = await whatsAppService.handleIncomingMessage(
      testSalonId,
      customerPhone,
      'staff_stylist-alice',
      'staff_stylist-alice',
    );

    expect(result.state).toBe(ConversationState.SELECT_DATE);
    expect(availabilityService.findAvailableDates).toHaveBeenCalledWith(
      testSalonId,
      'svc-haircut',
      'stylist-alice',
      2,
    );
    expect(sendSpy).toHaveBeenCalled();

    const payload = sendSpy.mock.calls[0][1];
    expect(payload.interactiveType).toBe('button');
    expect(payload.buttons.length).toBeGreaterThanOrEqual(2);
    expect(payload.buttons[0].id).toMatch(/^date_/);
  });

  // ---------------------------------------------------------------------------
  // 4. Date Selection & Real Slot Generation
  // ---------------------------------------------------------------------------
  it('TC-FLOW-004: Date selection queries AvailabilityService and displays real slot options', async () => {
    mockConversation.state = ConversationState.SELECT_DATE;
    mockConversation.selectedServiceId = 'svc-haircut';
    mockConversation.selectedStaffId = 'stylist-alice';

    const sendSpy = jest.spyOn(whatsAppService, 'sendMetaMessage');
    sendSpy.mockClear();

    const result = await whatsAppService.handleIncomingMessage(
      testSalonId,
      customerPhone,
      'date_2026-09-29',
      'date_2026-09-29',
    );

    expect(result.state).toBe(ConversationState.SELECT_TIME);
    expect(availabilityService.getAvailableSlots).toHaveBeenCalledWith(
      testSalonId,
      'svc-haircut',
      '2026-09-29',
      'stylist-alice',
    );

    const payload = sendSpy.mock.calls[0][1];
    expect(payload.interactiveType).toBe('list');
    expect(payload.listRows[0].id).toBe('slot_10:00');
    expect(payload.listRows[0].title).toBe('10:00 AM');
    expect(payload.listRows[1].id).toBe('slot_11:00');
    expect(payload.listRows[1].title).toBe('11:00 AM');
  });

  // ---------------------------------------------------------------------------
  // 5. Slot Selection & Confirmation Prompt
  // ---------------------------------------------------------------------------
  it('TC-FLOW-005: Slot selection prepares summary and presents Confirm Booking button', async () => {
    mockConversation.state = ConversationState.SELECT_TIME;
    mockConversation.selectedServiceId = 'svc-haircut';
    mockConversation.selectedStaffId = 'stylist-alice';
    mockConversation.selectedDate = new Date('2026-09-29T00:00:00.000Z');

    const sendSpy = jest.spyOn(whatsAppService, 'sendMetaMessage');
    sendSpy.mockClear();

    const result = await whatsAppService.handleIncomingMessage(
      testSalonId,
      customerPhone,
      'slot_10:00',
      'slot_10:00',
    );

    expect(result.state).toBe(ConversationState.CONFIRMATION);
    const payload = sendSpy.mock.calls[0][1];
    expect(payload.interactiveType).toBe('button');
    expect(payload.bodyText).toContain('Men Haircut');
    expect(payload.bodyText).toContain('Alice');
    expect(payload.buttons.some((b: any) => b.id === WhatsAppButtonId.CONFIRM_YES)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // 6. Booking Confirmation & AppointmentsService Delegation
  // ---------------------------------------------------------------------------
  it('TC-FLOW-006: Confirm booking triggers createAppointment with exact slot and date', async () => {
    mockConversation.state = ConversationState.CONFIRMATION;
    mockConversation.selectedServiceId = 'svc-haircut';
    mockConversation.selectedStaffId = 'stylist-alice';
    mockConversation.selectedDate = new Date('2026-09-29T00:00:00.000Z');
    mockConversation.selectedStartTime = DateTime.fromISO('2026-09-29', { zone: 'Asia/Kolkata' })
      .set({ hour: 10, minute: 0 })
      .toJSDate();

    const sendSpy = jest.spyOn(whatsAppService, 'sendMetaMessage');
    sendSpy.mockClear();

    const result = await whatsAppService.handleIncomingMessage(
      testSalonId,
      customerPhone,
      WhatsAppButtonId.CONFIRM_YES,
      WhatsAppButtonId.CONFIRM_YES,
    );

    expect(result.state).toBe(ConversationState.START);
    expect(appointmentsService.createAppointment).toHaveBeenCalledWith(
      testSalonId,
      expect.objectContaining({
        customerPhone,
        serviceIds: ['svc-haircut'],
        stylistId: 'stylist-alice',
        date: '2026-09-29',
        startTime: '10:00',
      }),
    );

    const payload = sendSpy.mock.calls[0][1];
    expect(payload.bodyText).toContain('Booking Confirmed');
  });

  // ---------------------------------------------------------------------------
  // 7. Reschedule Flow Delegation
  // ---------------------------------------------------------------------------
  it('TC-FLOW-007: Reschedule button scans real availability and rslot_ invokes RescheduleService', async () => {
    const activeAppt = {
      id: 'appt-exist-1',
      serviceId: 'svc-haircut',
      stylistId: 'stylist-alice',
      startAt: new Date(Date.now() + 5 * 3600 * 1000), // 5 hours in future (valid for reschedule)
      status: AppointmentStatus.CONFIRMED,
    };
    (prisma.appointment.findUnique as jest.Mock).mockResolvedValue(activeAppt);
    (prisma.appointment.findFirst as jest.Mock).mockResolvedValue(activeAppt);
    mockConversation.activeAppointmentId = activeAppt.id;

    const sendSpy = jest.spyOn(whatsAppService, 'sendMetaMessage');
    sendSpy.mockClear();

    // Step 1: Request Reschedule
    const resResult = await whatsAppService.handleIncomingMessage(
      testSalonId,
      customerPhone,
      WhatsAppButtonId.RESCHEDULE,
      WhatsAppButtonId.RESCHEDULE,
    );

    expect(resResult.state).toBe(ConversationState.SELECT_RESCHEDULE_DATE);
    expect(sendSpy).toHaveBeenCalled();
    const dateMenuPayload = sendSpy.mock.calls[0][1];
    expect(dateMenuPayload.buttons[0].id).toMatch(/^rdate_/);

    // Step 2: Choose Reschedule Date (rdate_)
    mockConversation.state = ConversationState.SELECT_RESCHEDULE_DATE;
    sendSpy.mockClear();
    const rdateResult = await whatsAppService.handleIncomingMessage(
      testSalonId,
      customerPhone,
      'rdate_2026-09-29',
      'rdate_2026-09-29',
    );
    expect(rdateResult.state).toBe(ConversationState.SELECT_RESCHEDULE_TIME);
    const slotPayload = sendSpy.mock.calls[0][1];
    expect(slotPayload.listRows[0].id).toBe('rslot_10:00');

    // Step 3: Choose Reschedule Slot (rslot_)
    mockConversation.state = ConversationState.SELECT_RESCHEDULE_TIME;
    mockConversation.selectedDate = new Date('2026-09-29T00:00:00.000Z');
    sendSpy.mockClear();
    const rslotResult = await whatsAppService.handleIncomingMessage(
      testSalonId,
      customerPhone,
      'rslot_11:00',
      'rslot_11:00',
    );
    expect(rslotResult.state).toBe(ConversationState.START);
    expect(rescheduleService.rescheduleAppointment).toHaveBeenCalledWith(
      testSalonId,
      activeAppt.id,
      expect.objectContaining({
        newDate: '2026-09-29',
        newStartTime: '11:00',
      }),
      undefined,
      expect.anything(),
    );
  });

  // ---------------------------------------------------------------------------
  // 8. Cancellation Penalty Delegation Check
  // ---------------------------------------------------------------------------
  it('TC-FLOW-008: Cancellation button checks penalty via CancellationService.checkCancellationPenalty', async () => {
    const activeAppt = {
      id: 'appt-exist-cancel',
      serviceId: 'svc-haircut',
      stylistId: 'stylist-alice',
      startAt: new Date(Date.now() + 1 * 3600 * 1000), // 1 hour away (within 2h window)
      status: AppointmentStatus.CONFIRMED,
    };
    (prisma.appointment.findUnique as jest.Mock).mockResolvedValue(activeAppt);
    (prisma.appointment.findFirst as jest.Mock).mockResolvedValue(activeAppt);
    mockConversation.activeAppointmentId = activeAppt.id;

    (cancellationService.checkCancellationPenalty as jest.Mock).mockResolvedValue({
      willIncurPenalty: true,
      hoursUntil: 1,
      cancelWindowHours: 2,
      apptStart: activeAppt.startAt,
    });

    const sendSpy = jest.spyOn(whatsAppService, 'sendMetaMessage');
    sendSpy.mockClear();

    const result = await whatsAppService.handleIncomingMessage(
      testSalonId,
      customerPhone,
      WhatsAppButtonId.CANCEL_APPT,
      WhatsAppButtonId.CANCEL_APPT,
    );

    expect(result.state).toBe(ConversationState.CONFIRM_CANCEL);
    expect(cancellationService.checkCancellationPenalty).toHaveBeenCalledWith(testSalonId, activeAppt.id);
    expect(sendSpy).toHaveBeenCalled();
    const payload = sendSpy.mock.calls[0][1];
    // Strike warning should be present in the confirmation prompt
    expect(payload.bodyText).toContain('Cancellation Warning');
    expect(payload.bodyText).toContain('Penalty Strike');
  });

  // ---------------------------------------------------------------------------
  // 9. Reschedule Cutoff Delegation Check (Blocked Flow)
  // ---------------------------------------------------------------------------
  it('TC-FLOW-009: Reschedule button respects cutoff when RescheduleService reports allowed=false', async () => {
    const activeAppt = {
      id: 'appt-exist-late',
      serviceId: 'svc-haircut',
      stylistId: 'stylist-alice',
      startAt: new Date(Date.now() + 30 * 60 * 1000), // 30 minutes away
      status: AppointmentStatus.CONFIRMED,
    };
    (prisma.appointment.findUnique as jest.Mock).mockResolvedValue(activeAppt);
    (prisma.appointment.findFirst as jest.Mock).mockResolvedValue(activeAppt);
    mockConversation.activeAppointmentId = activeAppt.id;

    (rescheduleService.validateRescheduleEligibility as jest.Mock).mockResolvedValue({
      allowed: false,
      reason: 'Appointment is within the 2h cutoff window',
      hoursUntil: 0.5,
      cancelWindowHours: 2,
    });

    const sendSpy = jest.spyOn(whatsAppService, 'sendMetaMessage');
    sendSpy.mockClear();

    const result = await whatsAppService.handleIncomingMessage(
      testSalonId,
      customerPhone,
      WhatsAppButtonId.RESCHEDULE,
      WhatsAppButtonId.RESCHEDULE,
    );

    expect(rescheduleService.validateRescheduleEligibility).toHaveBeenCalledWith(testSalonId, activeAppt.id);
    expect(sendSpy).toHaveBeenCalled();
    const payload = sendSpy.mock.calls[0][1];
    expect(payload.bodyText).toContain('Reschedule Cutoff Passed');
    expect(payload.bodyText).toContain('You cannot reschedule because the time cutoff has passed');
    // Did NOT transition to select reschedule date
    expect(result.state).not.toBe(ConversationState.SELECT_RESCHEDULE_DATE);
  });

  // ---------------------------------------------------------------------------
  // 10. handleServiceChosen Staff Delegation
  // ---------------------------------------------------------------------------
  it('TC-FLOW-010: handleServiceChosen delegates qualified staff lookup to AvailabilityService.getQualifiedStylists', async () => {
    const sendSpy = jest.spyOn(whatsAppService, 'sendMetaMessage');
    sendSpy.mockClear();

    const result = await whatsAppService.handleServiceChosen(
      mockConversation.id,
      customerPhone,
      mockSalon,
      mockSalon.services[0],
    );

    expect(availabilityService.getQualifiedStylists).toHaveBeenCalledWith(testSalonId, mockSalon.services[0].id);
    expect(result.state).toBe(ConversationState.SELECT_STAFF);
    expect(sendSpy).toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // 11. Quick Booking flow - Service Selection resolves earliest slot today
  // ---------------------------------------------------------------------------
  it('TC-FLOW-011: When in QUICK booking mode, selecting service resolves earliest slot today and prompts QUICK_BOOK_CONFIRM', async () => {
    mockConversation = {
      ...mockConversation,
      state: ConversationState.SELECT_SERVICE,
      quickCodeVerifiedAt: new Date(), // Marks QUICK booking mode
      tempBookingGender: ServiceGender.MALE,
    };

    const sendSpy = jest.spyOn(whatsAppService, 'sendMetaMessage');
    sendSpy.mockClear();

    const result = await whatsAppService.handleIncomingMessage(
      testSalonId,
      customerPhone,
      'svc_svc-haircut',
      'svc_svc-haircut',
    );

    expect(availabilityService.findEarliestAvailableSlotToday).toHaveBeenCalledWith(testSalonId, 'svc-haircut');
    expect(result.state).toBe(ConversationState.QUICK_BOOK_CONFIRM);
    expect(sendSpy).toHaveBeenCalled();
    const payload = sendSpy.mock.calls[0][1];
    expect(payload.bodyText).toContain('QUICK BOOKING DETAILS');
    expect(payload.bodyText).toContain('Men Haircut');
    expect(payload.bodyText).toContain('11:00 AM');
    expect(payload.buttons.some((b: any) => b.id === WhatsAppButtonId.CONFIRM_QUICK)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // 12. Quick Booking confirmation creates PENDING_ACCEPTANCE appointment
  // ---------------------------------------------------------------------------
  it('TC-FLOW-012: Confirming quick booking creates appointment with source QUICK_BOOK and PENDING_ACCEPTANCE', async () => {
    mockConversation = {
      ...mockConversation,
      state: ConversationState.QUICK_BOOK_CONFIRM,
      selectedServiceId: 'svc-haircut',
      selectedDate: new Date('2026-09-28T00:00:00Z'),
      selectedStartTime: new Date('2026-09-28T05:30:00Z'),
      selectedStaffId: 'stylist-alice',
      quickCodeVerifiedAt: new Date(),
    };

    const sendSpy = jest.spyOn(whatsAppService, 'sendMetaMessage');
    sendSpy.mockClear();

    const result = await whatsAppService.handleIncomingMessage(
      testSalonId,
      customerPhone,
      WhatsAppButtonId.CONFIRM_QUICK,
      WhatsAppButtonId.CONFIRM_QUICK,
    );

    expect(appointmentsService.createAppointment).toHaveBeenCalledWith(
      testSalonId,
      expect.objectContaining({
        customerPhone,
        serviceIds: ['svc-haircut'],
        stylistId: 'stylist-alice',
        source: 'QUICK_BOOK',
      }),
      undefined,
      { initialStatus: AppointmentStatus.PENDING_ACCEPTANCE },
    );

    expect(result.state).toBe(ConversationState.COMPLETED);
    expect(sendSpy).toHaveBeenCalled();
    const payload = sendSpy.mock.calls[0][1];
    expect(payload.bodyText).toContain('REQUEST SENT TO SALON');
  });
});
