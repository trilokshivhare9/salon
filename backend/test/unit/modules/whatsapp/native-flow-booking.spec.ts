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

describe('WhatsApp Native In-App Flow Booking (Meta Flow Integration)', () => {
  let whatsAppService: WhatsAppService;
  let appointmentsService: AppointmentsService;

  const testSalonId = 'salon-flow-test-123';
  const customerPhone = '919876543210';
  const flowId = '1988619778494177';

  const mockSalon = {
    id: testSalonId,
    name: 'Glow Unisex Salon',
    phone: '+919876543210',
    address: '456 MG Road, Indore',
    status: 'ACTIVE',
    timezone: 'Asia/Kolkata',
    serviceCategories: [
      { id: 'cat-1', name: 'Hair Services', sortOrder: 1 },
    ],
    services: [
      {
        id: 'svc-haircut',
        name: 'Signature Haircut',
        serviceCategoryId: 'cat-1',
        price: 600,
        durationMinutes: 30,
        gender: ServiceGender.UNISEX,
        status: 'ACTIVE',
      },
    ],
    stylists: [
      {
        id: 'stylist-vikram',
        name: 'Vikram',
        role: 'Senior Stylist',
        status: 'ACTIVE',
        services: [{ serviceId: 'svc-haircut' }],
      },
    ],
  };

  let mockConversation: any = {
    id: 'conv-flow-1',
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
    id: 'user-flow-1',
    phone: customerPhone,
    name: 'Amit Patel',
  };

  beforeEach(async () => {
    process.env.WHATSAPP_BOOKING_FLOW_ID = flowId;
    process.env.WHATSAPP_BOOKING_FLOW_MODE = 'draft';

    mockConversation = {
      id: 'conv-flow-1',
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

    const mockPrisma = {
      salon: {
        findUnique: jest.fn().mockResolvedValue(mockSalon),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue(mockUser),
        create: jest.fn().mockResolvedValue(mockUser),
      },
      salonUser: {
        findUnique: jest.fn().mockResolvedValue({ id: 'su-1', isBookingBlocked: false }),
        create: jest.fn().mockResolvedValue({ id: 'su-1', isBookingBlocked: false }),
        upsert: jest.fn().mockResolvedValue({ id: 'su-1', isBookingBlocked: false, userId: mockUser.id }),
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
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      whatsAppAccount: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      whatsAppLog: {
        create: jest.fn().mockResolvedValue(true),
      },
    };

    const mockAppointments = {
      createAppointment: jest.fn().mockImplementation(async (sId, dto) => ({
        id: 'appt-flow-999',
        appointmentNumber: 'FLOW-101',
        salonId: sId,
        customerName: dto.customerName,
        customerPhone: dto.customerPhone,
        serviceId: dto.serviceIds[0],
        serviceNameSnapshot: 'Signature Haircut',
        stylistId: dto.stylistId,
        startAt: new Date(),
        status: 'CONFIRMED',
        source: BookingSource.WHATSAPP,
      })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WhatsAppService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AppointmentsService, useValue: mockAppointments },
        { provide: AvailabilityService, useValue: {} },
        { provide: CancellationService, useValue: {} },
        { provide: RescheduleService, useValue: {} },
        { provide: QuickCodeService, useValue: {} },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'whatsapp.flowId') return flowId;
              if (key === 'whatsapp.flowMode') return 'draft';
              return null;
            }),
          },
        },
      ],
    }).compile();

    whatsAppService = module.get<WhatsAppService>(WhatsAppService);
    appointmentsService = module.get<AppointmentsService>(AppointmentsService);
  });

  afterEach(() => {
    delete process.env.WHATSAPP_BOOKING_FLOW_ID;
    delete process.env.WHATSAPP_BOOKING_FLOW_MODE;
  });

  // ---------------------------------------------------------------------------
  // TC 1: Triggering Native Flow when tapping "btn_book"
  // ---------------------------------------------------------------------------
  it('TC-FLOW-101: Tapping btn_book triggers Native Flow interactive message with flow_id and mode: draft', async () => {
    const sendSpy = jest.spyOn(whatsAppService, 'sendMetaMessage').mockResolvedValue(true);

    const result = await whatsAppService.handleIncomingMessage(
      testSalonId,
      customerPhone,
      'btn_book',
      'btn_book',
    );

    expect(sendSpy).toHaveBeenCalled();
    const payload = sendSpy.mock.calls[0][1];
    expect(payload.interactiveType).toBe('flow');
    expect(payload.flowId).toBe(flowId);
    expect(payload.flowMode).toBe('draft');
    expect(payload.flowActionPayload.screen).toBe('BOOKING_SCREEN');
    expect(payload.flowActionPayload.data.services).toHaveLength(1);
    expect(payload.flowActionPayload.data.services[0].id).toBe('svc-haircut');
    expect(payload.flowActionPayload.data.stylists.some((st: any) => st.id === 'stylist-vikram')).toBe(true);
    expect(payload.flowActionPayload.data.dates.length).toBeGreaterThan(0);
    expect(payload.flowActionPayload.data.slots.length).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // TC 2: Triggering Native Flow when typing "book" or "appointment"
  // ---------------------------------------------------------------------------
  it('TC-FLOW-102: Sending text message "book appointment" also triggers Native Flow', async () => {
    const sendSpy = jest.spyOn(whatsAppService, 'sendMetaMessage').mockResolvedValue(true);

    const result = await whatsAppService.handleIncomingMessage(
      testSalonId,
      customerPhone,
      'book',
      undefined,
    );

    expect(sendSpy).toHaveBeenCalled();
    const payload = sendSpy.mock.calls[0][1];
    expect(payload.interactiveType).toBe('flow');
    expect(payload.flowId).toBe(flowId);
  });

  // ---------------------------------------------------------------------------
  // TC 3: Handling Form Submission via nfm_reply (flow_response:)
  // ---------------------------------------------------------------------------
  it('TC-FLOW-103: Receiving flow_response parses JSON, creates appointment, and replies with confirmation', async () => {
    const sendSpy = jest.spyOn(whatsAppService, 'sendMetaMessage').mockResolvedValue(true);
    const flowJsonPayload = JSON.stringify({
      service_id: 'svc-haircut',
      stylist_id: 'stylist-vikram',
      date: '2026-10-01',
      time_slot: '11:00',
    });

    const result = await whatsAppService.handleIncomingMessage(
      testSalonId,
      customerPhone,
      'Form Submitted',
      `flow_response:${flowJsonPayload}`,
    );

    expect(appointmentsService.createAppointment).toHaveBeenCalledWith(
      testSalonId,
      expect.objectContaining({
        customerPhone: customerPhone,
        serviceIds: ['svc-haircut'],
        stylistId: 'stylist-vikram',
        date: '2026-10-01',
        startTime: '11:00',
        source: BookingSource.WHATSAPP,
      }),
    );

    expect(result.state).toBe(ConversationState.START);
    expect(sendSpy).toHaveBeenCalled();
    const replyPayload = sendSpy.mock.calls[0][1];
    expect(replyPayload.bodyText).toContain('Booking Confirmed');
    expect(replyPayload.bodyText).toContain('FLOW-101');
  });

  // ---------------------------------------------------------------------------
  // TC 4: Graceful handling of "any" stylist in Flow submission
  // ---------------------------------------------------------------------------
  it('TC-FLOW-104: Receiving flow_response with stylist_id = "any" converts stylistId to undefined', async () => {
    const sendSpy = jest.spyOn(whatsAppService, 'sendMetaMessage').mockResolvedValue(true);
    const flowJsonPayload = JSON.stringify({
      service_id: 'svc-haircut',
      stylist_id: 'any',
      date: '2026-10-01',
      time_slot: '14:00',
    });

    await whatsAppService.handleIncomingMessage(
      testSalonId,
      customerPhone,
      'Form Submitted',
      `flow_response:${flowJsonPayload}`,
    );

    expect(appointmentsService.createAppointment).toHaveBeenCalledWith(
      testSalonId,
      expect.objectContaining({
        stylistId: undefined,
        startTime: '14:00',
      }),
    );
  });
});
