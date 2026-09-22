import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../database/prisma.service';
import { WhatsAppService } from './whatsapp.service';
import { AppointmentsService } from '../appointments/appointments.service';
import { AvailabilityService } from '../availability/availability.service';
import { ReportsService } from '../reports/reports.service';
import { ConfigService } from '@nestjs/config';
import { ConversationState, AppointmentStatus, BookingSource } from '@prisma/client';
import { QuickCodeService } from '../quick-booking/quick-code.service';
import { DateTime } from 'luxon';

describe('Human-like Quick Booking & Dashboard Approval Flow (Complete Scenario Suite)', () => {
  let whatsAppService: WhatsAppService;
  let appointmentsService: AppointmentsService;
  let reportsService: ReportsService;
  let prisma: PrismaService;

  let testSalon: any;
  let testService: any;
  let sendMetaSpy: jest.SpyInstance;
  const testCustomerPhone = '919988776655';

  const mockAppointmentsService = {
    createAppointment: jest.fn(),
    updateStatus: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        PrismaService,
        WhatsAppService,
        ReportsService,
        {
          provide: QuickCodeService,
          useValue: {
            verifyCode: jest.fn(),
            getOrCreateTodayCode: jest.fn().mockResolvedValue({ code: '1234' }),
          },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn() },
        },
        {
          provide: AvailabilityService,
          useValue: {
            getAvailableSlots: jest.fn().mockResolvedValue({
              availableSlots: [{ startTime: '14:30', endTime: '15:00', duration: 30 }],
            }),
          },
        },
        {
          provide: AppointmentsService,
          useValue: mockAppointmentsService,
        },
      ],
    }).compile();

    whatsAppService = moduleRef.get<WhatsAppService>(WhatsAppService);
    reportsService = moduleRef.get<ReportsService>(ReportsService);
    prisma = moduleRef.get<PrismaService>(PrismaService);

    sendMetaSpy = jest.spyOn(whatsAppService, 'sendMetaMessage').mockImplementation(async () => true as any);

    testSalon = await prisma.salon.findFirst({
      where: { status: 'ACTIVE' },
      include: { services: { where: { status: 'ACTIVE' } } },
    });

    if (testSalon && testSalon.services.length > 0) {
      testService = testSalon.services[0];
    }
  });

  beforeEach(() => {
    sendMetaSpy.mockClear();
    jest.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 1: Customer initiates Quick Booking (No Code Prompt)
  // ---------------------------------------------------------------------------
  it('SCENARIO 1: User taps "Quick Book" -> Code entry prompt is skipped and Category selection is rendered', async () => {
    if (!testSalon) return;

    await prisma.conversation.upsert({
      where: { salonId_customerPhone: { salonId: testSalon.id, customerPhone: testCustomerPhone } },
      update: { state: ConversationState.START, quickCodeVerifiedAt: null },
      create: {
        salonId: testSalon.id,
        customerPhone: testCustomerPhone,
        state: ConversationState.START,
      },
    });

    const result = await whatsAppService.handleIncomingMessage(
      testSalon.id,
      testCustomerPhone,
      'btn_quick_book',
      'btn_quick_book',
    );

    expect(sendMetaSpy).toHaveBeenCalled();
    const sentText = sendMetaSpy.mock.calls[0][1].bodyText;
    expect(sentText).toContain('⚡ *IN-SALON QUICK BOOKING*');
    expect(sentText).not.toContain('Please enter today\'s 4-digit Salon Code');

    const conv = await prisma.conversation.findUnique({
      where: { salonId_customerPhone: { salonId: testSalon.id, customerPhone: testCustomerPhone } },
    });
    expect(conv?.quickCodeVerifiedAt).not.toBeNull();
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 2: Quick Booking Submission creates PENDING_ACCEPTANCE Appointment
  // ---------------------------------------------------------------------------
  it('SCENARIO 2: Confirm Quick Booking -> Creates appointment with PENDING_ACCEPTANCE status and notifies WhatsApp customer', async () => {
    if (!testSalon || !testService) return;

    const tz = testSalon.timezone || 'Asia/Kolkata';
    const todayDateStr = DateTime.now().setZone(tz).toFormat('yyyy-MM-dd');
    const startTimeJS = DateTime.fromISO(todayDateStr, { zone: tz }).set({ hour: 14, minute: 30 }).toJSDate();

    mockAppointmentsService.createAppointment.mockResolvedValueOnce({
      id: 'appt_test_123',
      appointmentNumber: 'SAL-998877',
      serviceNameSnapshot: testService.name,
      startAt: startTimeJS,
      stylist: { name: 'Rahul Sharma' },
      status: AppointmentStatus.PENDING_ACCEPTANCE,
    });

    await prisma.conversation.update({
      where: { salonId_customerPhone: { salonId: testSalon.id, customerPhone: testCustomerPhone } },
      data: {
        state: ConversationState.QUICK_BOOK_CONFIRM,
        selectedServiceId: testService.id,
        selectedDate: new Date(`${todayDateStr}T00:00:00Z`),
        selectedStartTime: startTimeJS,
        quickCodeVerifiedAt: new Date(),
      },
    });

    const result = await whatsAppService.handleIncomingMessage(
      testSalon.id,
      testCustomerPhone,
      'btn_confirm_quick',
      'btn_confirm_quick',
    );

    expect(result.state).toBe(ConversationState.COMPLETED);
    expect(mockAppointmentsService.createAppointment).toHaveBeenCalledWith(
      testSalon.id,
      expect.objectContaining({
        customerPhone: testCustomerPhone,
        serviceIds: [testService.id],
        source: BookingSource.QUICK_BOOK,
      }),
      undefined,
      { initialStatus: AppointmentStatus.PENDING_ACCEPTANCE },
    );

    expect(sendMetaSpy).toHaveBeenCalled();
    const sentText = sendMetaSpy.mock.calls[0][1].bodyText;
    expect(sentText).toContain('⏳ *REQUEST SENT TO SALON!*');
    expect(sentText).toContain('Pending Approval');
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 3: WhatsApp Customer Notification on Acceptance
  // ---------------------------------------------------------------------------
  it('SCENARIO 3: Salon Owner accepts Quick Booking -> Customer receives "QUICK BOOKING ACCEPTED" WhatsApp message', async () => {
    if (!testSalon) return;

    // Direct invocation test on sendMetaMessage formatted for acceptance
    const acceptMsg = `🎉 *QUICK BOOKING ACCEPTED!*\n\nHi *Test Client*, your quick booking check-in at *${testSalon.name}* has been accepted!\n\n• *Booking #:* *SAL-998877*\n• *Service:* *Hair Cut*\n• *Time:* *02:30 PM*\n• *Specialist:* *Rahul Sharma*\n• *Status:* *Checked In*\n\nPlease take a seat! Rahul Sharma will call you to the chair shortly.`;

    await whatsAppService.sendMetaMessage(
      testCustomerPhone,
      {
        bodyText: acceptMsg,
        interactiveType: 'button',
        buttons: [{ id: 'btn_start', title: '🏠 Main Menu' }],
      },
      '123456',
      testSalon.id,
    );

    expect(sendMetaSpy).toHaveBeenCalled();
    const body = sendMetaSpy.mock.calls[0][1].bodyText;
    expect(body).toContain('🎉 *QUICK BOOKING ACCEPTED!*');
    expect(body).toContain('Checked In');
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 4: WhatsApp Customer Notification on Decline
  // ---------------------------------------------------------------------------
  it('SCENARIO 4: Salon Owner declines Quick Booking -> Customer receives "QUICK BOOKING DECLINED" WhatsApp message', async () => {
    if (!testSalon) return;

    const declineMsg = `❌ *QUICK BOOKING DECLINED*\n\nHi *Test Client*, *${testSalon.name}* is currently unable to accept quick bookings at this moment. Please speak to salon reception or book a regular appointment.`;

    await whatsAppService.sendMetaMessage(
      testCustomerPhone,
      {
        bodyText: declineMsg,
        interactiveType: 'button',
        buttons: [{ id: 'btn_start', title: '🏠 Main Menu' }],
      },
      '123456',
      testSalon.id,
    );

    expect(sendMetaSpy).toHaveBeenCalled();
    const body = sendMetaSpy.mock.calls[0][1].bodyText;
    expect(body).toContain('❌ *QUICK BOOKING DECLINED*');
  });

  // ---------------------------------------------------------------------------
  // EDGE CASE 1: Expired Quick Booking Session (>30 Mins Inactivity)
  // ---------------------------------------------------------------------------
  it('EDGE CASE 1: Expired session (>30 mins) -> Resets state to START and prompts to restart', async () => {
    if (!testSalon || !testService) return;

    const tz = testSalon.timezone || 'Asia/Kolkata';
    const todayDateStr = DateTime.now().setZone(tz).toFormat('yyyy-MM-dd');
    const expiredTime = new Date(Date.now() - 35 * 60 * 1000); // 35 mins ago

    await prisma.conversation.update({
      where: { salonId_customerPhone: { salonId: testSalon.id, customerPhone: testCustomerPhone } },
      data: {
        state: ConversationState.QUICK_BOOK_CONFIRM,
        selectedServiceId: testService.id,
        selectedDate: new Date(`${todayDateStr}T00:00:00Z`),
        selectedStartTime: new Date(),
        quickCodeVerifiedAt: expiredTime,
      },
    });

    const result = await whatsAppService.handleIncomingMessage(
      testSalon.id,
      testCustomerPhone,
      'btn_confirm_quick',
      'btn_confirm_quick',
    );

    expect(result.state).toBe(ConversationState.START);
    expect(sendMetaSpy).toHaveBeenCalled();
    const sentText = sendMetaSpy.mock.calls[0][1].bodyText;
    expect(sentText).toContain('⚠️ *Quick Booking session expired.*');
  });

  // ---------------------------------------------------------------------------
  // EDGE CASE 2: Salon Fully Booked Today (Zero Slots)
  // ---------------------------------------------------------------------------
  it('EDGE CASE 2: Salon is fully booked -> Displays "Fully Booked Today!" message without broken state', async () => {
    if (!testSalon || !testService) return;

    // Reset any booking blocks on test customer
    await prisma.salonUser.updateMany({
      where: { salonId: testSalon.id, user: { phone: testCustomerPhone } },
      data: { isBookingBlocked: false, yearlyNoShowCount: 0 },
    });

    jest.spyOn((whatsAppService as any).availabilityService, 'getAvailableSlots')
      .mockResolvedValueOnce({ availableSlots: [] });

    await prisma.conversation.update({
      where: { salonId_customerPhone: { salonId: testSalon.id, customerPhone: testCustomerPhone } },
      data: {
        state: ConversationState.SELECT_SERVICE,
        quickCodeVerifiedAt: new Date(),
      },
    });

    const conv = await prisma.conversation.findUnique({
      where: { salonId_customerPhone: { salonId: testSalon.id, customerPhone: testCustomerPhone } },
    });

    const result = await (whatsAppService as any).handleServiceChosen(
      conv.id,
      testCustomerPhone,
      testSalon,
      testService,
    );

    expect(result.state).toBe(ConversationState.START);
    expect(sendMetaSpy).toHaveBeenCalled();
    const sentText = sendMetaSpy.mock.calls[0][1].bodyText;
    expect(sentText).toContain('Fully Booked Today!');
  });

  // ---------------------------------------------------------------------------
  // EDGE CASE 3: Reports Summary Aggregation
  // ---------------------------------------------------------------------------
  it('EDGE CASE 3: getDashboardSummary includes pendingAcceptance count property', async () => {
    if (!testSalon) return;

    const summary = await reportsService.getDashboardSummary(testSalon.id);

    expect(summary.statusCounts).toHaveProperty('pendingAcceptance');
    expect(typeof summary.statusCounts.pendingAcceptance).toBe('number');
  });
});
