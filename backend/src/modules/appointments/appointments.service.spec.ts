import { Test, TestingModule } from '@nestjs/testing';
import { AppointmentsService } from './appointments.service';
import { PrismaService } from '../../database/prisma.service';
import { AvailabilityService } from '../availability/availability.service';
import { BadRequestException } from '@nestjs/common';
import { AppointmentStatus } from '@prisma/client';

import { WhatsAppService } from '../whatsapp/whatsapp.service';

describe('AppointmentsService (Unit Tests)', () => {
  let service: AppointmentsService;
  let prisma: PrismaService;

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
            service: { findUnique: jest.fn() },
            appointment: { findFirst: jest.fn(), count: jest.fn(), update: jest.fn() },
            customer: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
            appointmentStatusHistory: { create: jest.fn() },
            $transaction: jest.fn((cb) => cb(prisma)),
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
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

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

  it('should allow valid status transition: CONFIRMED -> CHECKED_IN', async () => {
    jest.spyOn(service, 'getAppointmentById').mockResolvedValue({
      id: mockApptId,
      salonId: mockSalonId,
      status: AppointmentStatus.CONFIRMED,
      customerId: 'cust-1',
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
});
