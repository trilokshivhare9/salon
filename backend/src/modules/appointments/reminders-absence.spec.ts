import { Test, TestingModule } from '@nestjs/testing';
import { RemindersService } from './reminders.service';
import { PrismaService } from '../../database/prisma.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { AppointmentsService } from './appointments.service';
import { AppointmentStatus, ReassignmentOutcome, AbsenceStatus } from '@prisma/client';
import { DateTime } from 'luxon';

describe('RemindersService - Absence Immunity & Zero-Penalty Schedulers', () => {
  let service: RemindersService;
  let mockPrisma: any;
  let mockWhatsApp: any;
  let mockAppointmentsService: any;

  const mockSalonId = 'salon-remind-1';
  const mockTimezone = 'Asia/Kolkata';

  beforeEach(async () => {
    mockPrisma = {
      salon: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: mockSalonId,
            name: 'Elite Salon',
            status: 'ACTIVE',
            timezone: mockTimezone,
            whatsappAccount: { phoneNumberId: 'phone-id-123' },
          },
        ]),
      },
      appointment: {
        findMany: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      salonUser: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
    };

    mockWhatsApp = {
      sendMetaMessage: jest.fn().mockResolvedValue(true),
    };

    mockAppointmentsService = {
      updateStatus: jest.fn().mockResolvedValue(true),
      triggerSmartMoveUpBroadcast: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RemindersService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: WhatsAppService, useValue: mockWhatsApp },
        { provide: AppointmentsService, useValue: mockAppointmentsService },
      ],
    }).compile();

    service = module.get<RemindersService>(RemindersService);
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  describe('Stage 1 & Stage 2 Filter Verification', () => {
    it('should query appointments with reassignments: none for active NO_REPLACEMENT in Stage 1 and 2', async () => {
      mockPrisma.appointment.findMany.mockResolvedValue([]);

      await service.processReminders();

      // Check the findMany calls for stage1 and stage2
      expect(mockPrisma.appointment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            reassignments: {
              none: {
                outcome: ReassignmentOutcome.NO_REPLACEMENT,
                absence: { status: AbsenceStatus.ACTIVE },
              },
            },
          }),
        }),
      );
    });
  });

  describe('Stage 4 Auto-Cancellation with Absence Immunity', () => {
    it('should auto-cancel with SALON_EMERGENCY and ZERO customer penalty when active NO_REPLACEMENT absence exists', async () => {
      const now = DateTime.now().setZone(mockTimezone);
      const expiredAppt = {
        id: 'appt-absence-victim',
        startAt: now.minus({ minutes: 10 }).toJSDate(),
        status: AppointmentStatus.CONFIRMED,
        salonUserId: 'user-victim-1',
        salonUser: {
          user: { name: 'Priya', phone: '919876543210' },
        },
        stylist: { name: 'Absent Stylist' },
        service: { name: 'Hair Cut' },
        reassignments: [
          {
            outcome: ReassignmentOutcome.NO_REPLACEMENT,
            absence: { status: AbsenceStatus.ACTIVE },
          },
        ],
      };

      // Stage 1 & 2 return empty; Stage 4 returns expiredAppt
      mockPrisma.appointment.findMany
        .mockResolvedValueOnce([]) // stage 1
        .mockResolvedValueOnce([]) // stage 2
        .mockResolvedValueOnce([expiredAppt]); // stage 4

      const result = await service.processReminders();

      expect(result.stage4).toBe(1);

      // Verify appointmentsService.updateStatus was called with SALON_EMERGENCY
      expect(mockAppointmentsService.updateStatus).toHaveBeenCalledWith(
        mockSalonId,
        'appt-absence-victim',
        expect.objectContaining({
          status: AppointmentStatus.CANCELLED,
          reasonCategory: 'SALON_EMERGENCY',
        }),
        'SYSTEM_REMINDERS_WORKER',
      );

      // Verify customer yearlyNoShowCount was NOT touched and appointment was NOT marked NO_SHOW
      expect(mockPrisma.salonUser.update).not.toHaveBeenCalled();
    });

    it('should apply NO_SHOW and increment penalty strike for normal customer who failed to arrive', async () => {
      const now = DateTime.now().setZone(mockTimezone);
      const normalExpiredAppt = {
        id: 'appt-normal-noshow',
        startAt: now.minus({ minutes: 10 }).toJSDate(),
        status: AppointmentStatus.CONFIRMED,
        salonUserId: 'user-normal-1',
        salonUser: {
          user: { name: 'Rohan', phone: '919876543211' },
          yearlyNoShowCount: 1,
        },
        stylist: { name: 'Working Stylist' },
        service: { name: 'Beard Trim' },
        reassignments: [], // No absence
      };

      mockPrisma.appointment.findMany
        .mockResolvedValueOnce([]) // stage 1
        .mockResolvedValueOnce([]) // stage 2
        .mockResolvedValueOnce([normalExpiredAppt]); // stage 4

      mockPrisma.salonUser.findUnique.mockResolvedValue({
        id: 'user-normal-1',
        yearlyNoShowCount: 1,
      });

      const result = await service.processReminders();

      expect(result.stage4).toBe(1);
      expect(mockPrisma.appointment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'appt-normal-noshow' },
          data: expect.objectContaining({
            status: AppointmentStatus.NO_SHOW,
          }),
        }),
      );

      // Verify penalty strike applied (1 -> 2)
      expect(mockPrisma.salonUser.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-normal-1' },
          data: expect.objectContaining({
            yearlyNoShowCount: 2,
            isBookingBlocked: false,
          }),
        }),
      );
    });
  });
});
