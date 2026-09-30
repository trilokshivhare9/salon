import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../../src/database/prisma.service';
import { WhatsAppService } from '../../../../src/modules/channels/whatsapp/whatsapp.service';
import { AppointmentsService } from '../../../../src/modules/salon-admin/appointments/appointments.service';
import { AvailabilityService } from '../../../../src/modules/salon-admin/availability/availability.service';
import { CancellationService } from '../../../../src/modules/salon-admin/appointments/cancellation/cancellation.service';
import { RescheduleService } from '../../../../src/modules/salon-admin/appointments/reschedule/reschedule.service';
import { ConfigService } from '@nestjs/config';
import { ConversationState, ServiceGender, BookingSource } from '@prisma/client';
import { QuickCodeService } from '../../../../src/modules/salon-admin/quick-booking/quick-code.service';

describe('WhatsApp Streamlined 2-Tap Interactive Booking Flow', () => {
  let whatsAppService: WhatsAppService;
  let availabilityService: AvailabilityService;
  let appointmentsService: AppointmentsService;

  const testSalonId = 'salon-2tap-123';
  const customerPhone = '919876543210';

  const mockSalon = {
    id: testSalonId,
    name: 'Luxury Salon',
    phone: '+919876543210',
    address: '123 Main St',
    status: 'ACTIVE',
    timezone: 'Asia/Kolkata',
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
        services: [{ serviceId: 'svc-spa' }],
      },
    ],
  };

  let mockConversation: any = {
    id: 'conv-2tap-1',
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
    id: 'user-2tap-1',
    phone: customerPhone,
    name: 'Rahul Sharma',
  };

  beforeEach(async () => {
    mockConversation = {
      id: 'conv-2tap-1',
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
        availableSlots: [
          {
            startTime: '10:00',
            endTime: '10:30',
            availableStaffCount: 1,
            eligibleStaffIds: ['stylist-alice'],
          },
          {
            startTime: '11:30',
            endTime: '12:00',
            availableStaffCount: 1,
            eligibleStaffIds: ['stylist-alice'],
          },
        ],
      }),
    };

    const mockAppointmentsService: any = {
      createAppointment: jest.fn().mockResolvedValue({
        id: 'appt-2tap-1',
        appointmentNumber: 'APT-2TAP',
        startTime: '2026-09-29T10:00:00.000Z',
        startAt: new Date('2026-09-29T10:00:00.000Z'),
        price: 500,
        service: { name: 'Men Haircut' },
        stylist: { name: 'Alice' },
      }),
      updateStatus: jest.fn().mockResolvedValue(true),
      updateEtaStatus: jest.fn().mockResolvedValue(true),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        WhatsAppService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: AvailabilityService, useValue: mockAvailabilityService },
        { provide: AppointmentsService, useValue: mockAppointmentsService },
        { provide: CancellationService, useValue: { cancelBooking: jest.fn() } },
        { provide: RescheduleService, useValue: { rescheduleAppointment: jest.fn() } },
        { provide: QuickCodeService, useValue: { verifyCode: jest.fn() } },
      ],
    }).compile();

    whatsAppService = moduleRef.get<WhatsAppService>(WhatsAppService);
    availabilityService = moduleRef.get<AvailabilityService>(AvailabilityService);
    appointmentsService = moduleRef.get<AppointmentsService>(AppointmentsService);

    jest.spyOn(whatsAppService, 'sendMetaMessage').mockImplementation(async () => true as any);
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 1: Tap 1 -> Selecting a Service (qsvc_*) presents Direct Quick Slots Menu
  // ---------------------------------------------------------------------------
  it('TC-2TAP-001: Selecting service via qsvc_* directly presents available instant slots today & tomorrow', async () => {
    mockConversation.state = ConversationState.SELECT_SERVICE;
    const sendSpy = jest.spyOn(whatsAppService, 'sendMetaMessage');
    sendSpy.mockClear();

    const result = await whatsAppService.handleIncomingMessage(
      testSalonId,
      customerPhone,
      'qsvc_svc-haircut',
      'qsvc_svc-haircut',
    );

    expect(result.state).toBe(ConversationState.SELECT_TIME);
    expect(availabilityService.findAvailableDates).toHaveBeenCalledWith(testSalonId, 'svc-haircut', undefined, 2);
    expect(sendSpy).toHaveBeenCalled();

    const payload = sendSpy.mock.calls[0][1];
    expect(payload.interactiveType).toBe('list');
    expect(payload.listRows.length).toBeGreaterThanOrEqual(2);

    // Verify instant slot rows
    const slotRow = payload.listRows.find((r: any) => r.id.startsWith('qslot_'));
    expect(slotRow).toBeDefined();
    expect(slotRow.id).toContain('10:00');

    // Verify customization rows
    expect(payload.listRows.some((r: any) => r.id === 'btn_pick_stylist_svc-haircut')).toBe(true);
    expect(payload.listRows.some((r: any) => r.id === 'btn_pick_custom_date_svc-haircut')).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 2: Tap 2 -> Selecting an Instant Slot (qslot_*) creates and confirms appointment immediately
  // ---------------------------------------------------------------------------
  it('TC-2TAP-002: Tapping an instant slot creates and confirms appointment in 1-shot with WHATSAPP source', async () => {
    mockConversation.state = ConversationState.SELECT_TIME;
    mockConversation.selectedServiceId = 'svc-haircut';

    const sendSpy = jest.spyOn(whatsAppService, 'sendMetaMessage');
    sendSpy.mockClear();

    const result = await whatsAppService.handleIncomingMessage(
      testSalonId,
      customerPhone,
      'qslot_2026-09-29_10:00_stylist-alice',
      'qslot_2026-09-29_10:00_stylist-alice',
    );

    expect(appointmentsService.createAppointment).toHaveBeenCalledWith(testSalonId, {
      customerPhone,
      customerName: 'Rahul Sharma',
      serviceIds: ['svc-haircut'],
      stylistId: 'stylist-alice',
      date: '2026-09-29',
      startTime: '10:00',
      source: BookingSource.WHATSAPP,
    });

    expect(result.state).toBe(ConversationState.START);
    expect(sendSpy).toHaveBeenCalled();
    const payload = sendSpy.mock.calls[0][1];
    expect(payload.bodyText).toContain('Men Haircut');
    expect(payload.bodyText).toContain('APT-2TAP');
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 3: Tapping an Instant Slot with 'any' specialist
  // ---------------------------------------------------------------------------
  it('TC-2TAP-003: Tapping instant slot with "any" specialist passes undefined stylistId to auto-assign', async () => {
    mockConversation.state = ConversationState.SELECT_TIME;
    mockConversation.selectedServiceId = 'svc-haircut';

    const result = await whatsAppService.handleIncomingMessage(
      testSalonId,
      customerPhone,
      'qslot_2026-09-29_11:30_any',
      'qslot_2026-09-29_11:30_any',
    );

    expect(appointmentsService.createAppointment).toHaveBeenCalledWith(testSalonId, expect.objectContaining({
      customerPhone,
      stylistId: undefined,
      date: '2026-09-29',
      startTime: '11:30',
    }));
    expect(result.state).toBe(ConversationState.START);
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 4: Customization -> Pick Specialist button transitions to SELECT_STAFF
  // ---------------------------------------------------------------------------
  it('TC-2TAP-004: Clicking "Pick Specialist" from Quick Slots list routes to SELECT_STAFF with qualified stylists', async () => {
    mockConversation.state = ConversationState.SELECT_TIME;
    mockConversation.selectedServiceId = 'svc-haircut';

    const sendSpy = jest.spyOn(whatsAppService, 'sendMetaMessage');
    sendSpy.mockClear();

    const result = await whatsAppService.handleIncomingMessage(
      testSalonId,
      customerPhone,
      'btn_pick_stylist_svc-haircut',
      'btn_pick_stylist_svc-haircut',
    );

    expect(result.state).toBe(ConversationState.SELECT_STAFF);
    expect(availabilityService.getQualifiedStylists).toHaveBeenCalledWith(testSalonId, 'svc-haircut');
    expect(sendSpy).toHaveBeenCalled();
    const payload = sendSpy.mock.calls[0][1];
    expect(payload.listRows.some((r: any) => r.id === 'staff_stylist-alice')).toBe(true);
    expect(payload.listRows.some((r: any) => r.id === 'staff_stylist-bob')).toBe(false); // Bob unqualified
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 5: Customization -> Pick Other Date transitions to SELECT_DATE
  // ---------------------------------------------------------------------------
  it('TC-2TAP-005: Clicking "Pick Other Date" routes to calendar Date Selection with upcoming dates', async () => {
    mockConversation.state = ConversationState.SELECT_TIME;
    mockConversation.selectedServiceId = 'svc-haircut';

    const sendSpy = jest.spyOn(whatsAppService, 'sendMetaMessage');
    sendSpy.mockClear();

    const result = await whatsAppService.handleIncomingMessage(
      testSalonId,
      customerPhone,
      'btn_pick_custom_date_svc-haircut',
      'btn_pick_custom_date_svc-haircut',
    );

    expect(result.state).toBe(ConversationState.SELECT_DATE);
    expect(availabilityService.findAvailableDates).toHaveBeenCalledWith(testSalonId, 'svc-haircut', undefined, 4);
    expect(sendSpy).toHaveBeenCalled();
    const payload = sendSpy.mock.calls[0][1];
    expect(payload.buttons.some((b: any) => b.id.startsWith('date_'))).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 6: Graceful fallback when today & tomorrow are fully booked
  // ---------------------------------------------------------------------------
  it('TC-2TAP-006: When today and tomorrow are fully booked, advances cleanly to SELECT_DATE with calendar dates', async () => {
    mockConversation.state = ConversationState.SELECT_SERVICE;

    // Simulate empty slots for today & tomorrow
    jest.spyOn(availabilityService, 'findAvailableDates').mockImplementation(async (salonId, svcId, staffId, days) => {
      if (days === 2) return []; // No dates today/tomorrow
      return [{ dateStr: '2026-10-02', displayLabel: 'Fri, Oct 2' }];
    });

    const sendSpy = jest.spyOn(whatsAppService, 'sendMetaMessage');
    sendSpy.mockClear();

    const result = await whatsAppService.handleIncomingMessage(
      testSalonId,
      customerPhone,
      'qsvc_svc-haircut',
      'qsvc_svc-haircut',
    );

    expect(result.state).toBe(ConversationState.SELECT_DATE);
    expect(sendSpy).toHaveBeenCalled();
    const payload = sendSpy.mock.calls[0][1];
    expect(payload.bodyText).toContain('Today and tomorrow are fully booked');
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 7: Graceful rejection when no stylists are qualified for the service
  // ---------------------------------------------------------------------------
  it('TC-2TAP-007: When no specialists are assigned to the service, rejects gracefully with guidance', async () => {
    mockConversation.state = ConversationState.SELECT_SERVICE;

    jest.spyOn(availabilityService, 'getQualifiedStylists').mockResolvedValue([]);

    const sendSpy = jest.spyOn(whatsAppService, 'sendMetaMessage');
    sendSpy.mockClear();

    const result = await whatsAppService.handleIncomingMessage(
      testSalonId,
      customerPhone,
      'qsvc_svc-haircut',
      'qsvc_svc-haircut',
    );

    expect(result.state).toBe(ConversationState.SELECT_SERVICE);
    expect(sendSpy).toHaveBeenCalled();
    const payload = sendSpy.mock.calls[0][1];
    expect(payload.bodyText).toContain('no specialists are currently assigned');
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 8: Missing service context when tapping qslot_* gracefully redirects to catalog
  // ---------------------------------------------------------------------------
  it('TC-2TAP-008: Missing serviceId in active session redirects gracefully to sectioned service catalog', async () => {
    mockConversation.state = ConversationState.SELECT_TIME;
    mockConversation.selectedServiceId = null;

    const sendSpy = jest.spyOn(whatsAppService, 'sendMetaMessage');
    sendSpy.mockClear();

    const result = await whatsAppService.handleIncomingMessage(
      testSalonId,
      customerPhone,
      'qslot_2026-09-29_10:00_stylist-alice',
      'qslot_2026-09-29_10:00_stylist-alice',
    );

    expect(result.state).toBe(ConversationState.SELECT_SERVICE);
    expect(sendSpy).toHaveBeenCalled();
    const payload = sendSpy.mock.calls[0][1];
    expect(payload.interactiveType).toBe('list');
  });
});
