import { Test, TestingModule } from '@nestjs/testing';
import { ServicesService } from './services.service';
import { PrismaService } from '../../database/prisma.service';
import { AppointmentsService } from '../appointments/appointments.service';
import { BadRequestException } from '@nestjs/common';
import { ServiceStatus } from '@prisma/client';

describe('ServicesService - Duration Logic Tests', () => {
  let service: ServicesService;
  let prisma: PrismaService;

  const mockSalonId = 'salon-test-123';
  const mockServiceId = 'service-test-456';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ServicesService,
        {
          provide: PrismaService,
          useValue: {
            service: {
              create: jest.fn(),
              update: jest.fn(),
              findMany: jest.fn(),
              findFirst: jest.fn(),
              count: jest.fn().mockResolvedValue(1),
            },
            stylist: {
              count: jest.fn().mockResolvedValue(1),
            },
            salon: {
              update: jest.fn().mockResolvedValue({}),
            },
          },
        },
        {
          provide: AppointmentsService,
          useValue: {
            emitSalonEvent: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<ServicesService>(ServicesService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe('createService duration rules (>= 30 and multiple of 15)', () => {
    it('should reject duration less than 30 (e.g. 15, 20, 25)', async () => {
      for (const dur of [15, 20, 25]) {
        await expect(
          service.createService(mockSalonId, {
            name: 'Quick Shave',
            price: 50,
            durationMinutes: dur,
          }),
        ).rejects.toThrow(BadRequestException);
      }
    });

    it('should reject duration not a multiple of 15 (e.g. 35, 40, 50)', async () => {
      for (const dur of [35, 40, 50, 70]) {
        await expect(
          service.createService(mockSalonId, {
            name: 'Irregular Service',
            price: 100,
            durationMinutes: dur,
          }),
        ).rejects.toThrow(BadRequestException);
      }
    });

    it('should accept valid durations starting from 30 in multiples of 15 (30, 45, 60, 75, 90, 120)', async () => {
      for (const dur of [30, 45, 60, 75, 90, 105, 120, 180]) {
        jest.spyOn(prisma.service, 'create').mockResolvedValue({
          id: `svc-${dur}`,
          salonId: mockSalonId,
          name: `Service ${dur}m`,
          price: 100,
          durationMinutes: dur,
          status: ServiceStatus.ACTIVE,
        } as any);

        const created = await service.createService(mockSalonId, {
          name: `Service ${dur}m`,
          price: 100,
          durationMinutes: dur,
        });

        expect(created).toBeDefined();
        expect(created.durationMinutes).toBe(dur);
      }
    });
  });

  describe('updateService duration rules (>= 30 and multiple of 15)', () => {
    beforeEach(() => {
      jest.spyOn(prisma.service, 'findFirst').mockResolvedValue({
        id: mockServiceId,
        salonId: mockSalonId,
        name: 'Existing Service',
        price: 100,
        durationMinutes: 30,
        status: ServiceStatus.ACTIVE,
      } as any);
    });

    it('should reject updating to duration less than 30', async () => {
      for (const dur of [15, 20, 25]) {
        await expect(
          service.updateService(mockSalonId, mockServiceId, {
            durationMinutes: dur,
          }),
        ).rejects.toThrow(BadRequestException);
      }
    });

    it('should reject updating to duration not multiple of 15', async () => {
      for (const dur of [35, 50, 65]) {
        await expect(
          service.updateService(mockSalonId, mockServiceId, {
            durationMinutes: dur,
          }),
        ).rejects.toThrow(BadRequestException);
      }
    });

    it('should accept updating to valid multiples of 15 >= 30 (45, 60, 90)', async () => {
      for (const dur of [30, 45, 60, 90, 120]) {
        jest.spyOn(prisma.service, 'update').mockResolvedValue({
          id: mockServiceId,
          salonId: mockSalonId,
          name: 'Existing Service',
          price: 100,
          durationMinutes: dur,
          status: ServiceStatus.ACTIVE,
        } as any);

        const updated = await service.updateService(mockSalonId, mockServiceId, {
          durationMinutes: dur,
        });

        expect(updated.durationMinutes).toBe(dur);
      }
    });
  });
});
