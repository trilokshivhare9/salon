import { Test, TestingModule } from '@nestjs/testing';
import { AppointmentsService, VALID_STATUS_TRANSITIONS } from './appointments.service';
import { PrismaService } from '../../database/prisma.service';
import { AvailabilityService } from '../availability/availability.service';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { AppointmentStatus, BookingSource } from '@prisma/client';
import { WhatsAppService } from '../whatsapp/whatsapp.service';

describe('AppointmentsService (Unit Tests)', () => {
  let service: AppointmentsService;
  let prisma: PrismaService;
  let availabilityService: AvailabilityService;

  const mockSalonId = 'salon-123';
  const mockApptId = 'appt-123';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AppointmentsService,
        {
          provide: PrismaService,
          useValue: {
            salon: { findUnique: jest.fn() },
            salonWorkingHours: { findUnique: jest.fn().mockResolvedValue({ startTime: '09:00', endTime: '21:00', isClosed: false }) },
            stylist: { findUnique: jest.fn().mockResolvedValue({ id: 'sty-1', followsSalonSchedule: false, status: 'ACTIVE' }), findMany: jest.fn() },
            stylistService: { findMany: jest.fn().mockResolvedValue([{ id: 'ss-1' }]), findFirst: jest.fn().mockResolvedValue({ id: 'ss-1' }) },
            service: { findMany: jest.fn().mockResolvedValue([{ id: 'srv-1', salonId: mockSalonId, name: 'Haircut', durationMinutes: 30, price: 300, status: 'ACTIVE' }]), findFirst: jest.fn().mockResolvedValue({ id: 'srv-1', salonId: mockSalonId, status: 'ACTIVE' }), findUnique: jest.fn() },
            appointment: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), count: jest.fn() },
            appointmentService: { createMany: jest.fn(), create: jest.fn(), count: jest.fn() },
            user: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
            salonUser: { upsert: jest.fn(), findFirst: jest.fn() },
            notification: { create: jest.fn() },
            $transaction: jest.fn(async (cb) => {
              if (typeof cb === 'function') {
                return cb(prisma);
              }
              return prisma;
            }),
            $executeRawUnsafe: jest.fn().mockResolvedValue(1),
            $queryRawUnsafe: jest.fn().mockResolvedValue([{ pg_try_advisory_xact_lock: true }]),
          },
        },
        {
          provide: AvailabilityService,
          useValue: {
            getAvailableSlots: jest.fn(),
          },
        },
        {
          provide: WhatsAppService,
          useValue: {
            sendMetaMessage: jest.fn().mockResolvedValue({ success: true }),
          },
        },
      ],
    }).compile();

    service = module.get<AppointmentsService>(AppointmentsService);
    prisma = module.get<PrismaService>(PrismaService);
    availabilityService = module.get<AvailabilityService>(AvailabilityService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('Status State Transitions', () => {
    it('should reject invalid status transition: COMPLETED -> CANCELLED', async () => {
      jest.spyOn(service, 'getAppointmentById').mockResolvedValue({
        id: mockApptId,
        salonId: mockSalonId,
        status: AppointmentStatus.COMPLETED,
      } as any);

      await expect(
        service.updateStatus(mockSalonId, mockApptId, {
          status: AppointmentStatus.CANCELLED,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject invalid status transition: IN_SERVICE -> CANCELLED', async () => {
      jest.spyOn(service, 'getAppointmentById').mockResolvedValue({
        id: mockApptId,
        salonId: mockSalonId,
        status: AppointmentStatus.IN_SERVICE,
      } as any);

      await expect(
        service.updateStatus(mockSalonId, mockApptId, {
          status: AppointmentStatus.CANCELLED,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should allow valid status transition: CONFIRMED -> CHECKED_IN', async () => {
      jest.spyOn(service, 'getAppointmentById').mockResolvedValue({
        id: mockApptId,
        salonId: mockSalonId,
        status: AppointmentStatus.CONFIRMED,
        salonUserId: 'su-1',
      } as any);

      jest.spyOn(prisma.appointment, 'update').mockResolvedValue({
        id: mockApptId,
        status: AppointmentStatus.CHECKED_IN,
      } as any);

      const result = await service.updateStatus(mockSalonId, mockApptId, {
        status: AppointmentStatus.CHECKED_IN,
      });

      expect(result.status).toBe(AppointmentStatus.CHECKED_IN);
    });

    it('should allow valid status transition: CHECKED_IN -> CANCELLED (counter cancellation)', async () => {
      jest.spyOn(service, 'getAppointmentById').mockResolvedValue({
        id: mockApptId,
        salonId: mockSalonId,
        status: AppointmentStatus.CHECKED_IN,
        salonUserId: 'su-1',
      } as any);

      jest.spyOn(prisma.appointment, 'update').mockResolvedValue({
        id: mockApptId,
        status: AppointmentStatus.CANCELLED,
      } as any);

      const result = await service.updateStatus(mockSalonId, mockApptId, {
        status: AppointmentStatus.CANCELLED,
      });

      expect(result.status).toBe(AppointmentStatus.CANCELLED);
    });

    it('should allow valid status transition: IN_SERVICE -> COMPLETED', async () => {
      jest.spyOn(service, 'getAppointmentById').mockResolvedValue({
        id: mockApptId,
        salonId: mockSalonId,
        status: AppointmentStatus.IN_SERVICE,
      } as any);

      jest.spyOn(prisma.appointment, 'update').mockResolvedValue({
        id: mockApptId,
        status: AppointmentStatus.COMPLETED,
      } as any);

      const result = await service.updateStatus(mockSalonId, mockApptId, {
        status: AppointmentStatus.COMPLETED,
      });

      expect(result.status).toBe(AppointmentStatus.COMPLETED);
    });
  });

  describe('Rescheduling', () => {
    it('should reject reschedule if appointment is not CONFIRMED', async () => {
      jest.spyOn(service, 'getAppointmentById').mockResolvedValue({
        id: mockApptId,
        salonId: mockSalonId,
        status: AppointmentStatus.CHECKED_IN,
      } as any);

      await expect(
        service.rescheduleAppointment(mockSalonId, mockApptId, {
          newDate: '2026-09-08',
          newStartTime: '14:00',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject reschedule if within 2 hours cutoff and not admin', async () => {
      // 30 minutes in the future
      const soon = new Date(Date.now() + 30 * 60 * 1000);
      jest.spyOn(service, 'getAppointmentById').mockResolvedValue({
        id: mockApptId,
        salonId: mockSalonId,
        status: AppointmentStatus.CONFIRMED,
        startAt: soon,
      } as any);

      jest.spyOn(prisma.salon, 'findUnique').mockResolvedValue({
        id: mockSalonId,
        cancelWindowHours: 2,
        timezone: 'Asia/Kolkata',
      } as any);

      await expect(
        service.rescheduleAppointment(mockSalonId, mockApptId, {
          newDate: '2026-09-08',
          newStartTime: '14:00',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should allow reschedule if within 2 hours cutoff when overridden by admin', async () => {
      const soon = new Date(Date.now() + 30 * 60 * 1000);
      jest.spyOn(service, 'getAppointmentById').mockResolvedValue({
        id: mockApptId,
        salonId: mockSalonId,
        status: AppointmentStatus.CONFIRMED,
        startAt: soon,
        durationMinutes: 30,
        serviceId: 'srv-1',
        stylistId: 'sty-1',
        salonUserId: 'su-1',
      } as any);

      jest.spyOn(prisma.salon, 'findUnique').mockResolvedValue({
        id: mockSalonId,
        cancelWindowHours: 2,
        timezone: 'Asia/Kolkata',
      } as any);

      jest.spyOn(availabilityService, 'getAvailableSlots').mockResolvedValue({
        date: '2026-09-08',
        salonTimezone: 'Asia/Kolkata',
        serviceDurationMinutes: 30,
        availableSlots: [
          {
            startTime: '14:00',
            endTime: '14:30',
            isoStartTime: '2026-09-08T08:30:00.000Z',
            isoEndTime: '2026-09-08T09:00:00.000Z',
            availableStaffCount: 1,
            eligibleStaffIds: ['sty-1'],
          },
        ],
      });

      jest.spyOn(prisma.appointment, 'findFirst').mockResolvedValue(null); // No overlap
      jest.spyOn(prisma.appointment, 'update').mockResolvedValue({
        id: mockApptId,
        status: AppointmentStatus.CONFIRMED,
        startAt: new Date('2026-09-08T08:30:00.000Z'),
        endAt: new Date('2026-09-08T09:00:00.000Z'),
        appointmentDate: new Date('2026-09-08'),
      } as any);

      const result = await service.rescheduleAppointment(
        mockSalonId,
        mockApptId,
        {
          newDate: '2026-09-08',
          newStartTime: '14:00',
        },
        'admin-override-user',
      );

      expect(result).toBeDefined();
      expect(result.status).toBe(AppointmentStatus.CONFIRMED);
    });
  });

  describe('Appointment Creation & Salon-Scoped Overlap', () => {
    it('should reject booking if customer already has an active appointment in this salon at the same time', async () => {
      jest.spyOn(prisma.salon, 'findUnique').mockResolvedValue({
        id: mockSalonId,
        status: 'ACTIVE',
        timezone: 'Asia/Kolkata',
      } as any);

      jest.spyOn(prisma.service, 'findMany').mockResolvedValue([
        { id: 'srv-1', salonId: mockSalonId, name: 'Haircut', durationMinutes: 30, price: 300, status: 'ACTIVE' },
      ] as any);

      jest.spyOn(availabilityService, 'getAvailableSlots').mockResolvedValue({
        date: '2026-09-08',
        salonTimezone: 'Asia/Kolkata',
        serviceDurationMinutes: 30,
        availableSlots: [
          {
            startTime: '11:00',
            endTime: '11:30',
            isoStartTime: '2026-09-08T05:30:00.000Z',
            isoEndTime: '2026-09-08T06:00:00.000Z',
            availableStaffCount: 1,
            eligibleStaffIds: ['sty-1'],
          },
        ],
      });

      jest.spyOn(prisma.user, 'findUnique').mockResolvedValue({ id: 'u-1', phone: '+919876543210' } as any);
      jest.spyOn(prisma.salonUser, 'upsert').mockResolvedValue({ id: 'su-1', salonId: mockSalonId, userId: 'u-1' } as any);

      // Customer already has overlapping appointment
      jest.spyOn(prisma.appointment, 'findFirst').mockResolvedValue({
        id: 'existing-cust-appt',
        salonUserId: 'su-1',
      } as any);

      await expect(
        service.createAppointment(mockSalonId, {
          serviceId: 'srv-1',
          date: '2026-09-08',
          startTime: '11:00',
          customerPhone: '+919876543210',
          source: BookingSource.WEB,
        }),
      ).rejects.toThrow(ConflictException);
    });
  });
});
