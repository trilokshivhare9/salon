import { Test, TestingModule } from '@nestjs/testing';
import { ServicesService } from './services.service';
import { PrismaService } from '../../database/prisma.service';
import { AppointmentsService } from '../appointments/appointments.service';
import { BadRequestException } from '@nestjs/common';
import { ServiceStatus, StylistStatus, AppointmentStatus } from '@prisma/client';

describe('ServicesService - Duration & Staff Qualification Tests', () => {
  let service: ServicesService;
  let mockPrisma: any;

  const mockSalonId = 'salon-test-123';
  const mockServiceId = 'service-test-456';

  beforeEach(async () => {
    mockPrisma = {
      service: {
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        count: jest.fn().mockResolvedValue(1),
      },
      stylist: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([]),
      },
      stylistService: {
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      salon: {
        update: jest.fn().mockResolvedValue({}),
      },
      appointment: {
        count: jest.fn().mockResolvedValue(0),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      conversation: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      $transaction: jest.fn(async (cb: any) => {
        if (typeof cb === 'function') {
          return cb(mockPrisma);
        }
        return Promise.all(cb);
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ServicesService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
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
        const mockCreated = {
          id: `svc-${dur}`,
          salonId: mockSalonId,
          name: `Service ${dur}m`,
          price: 100,
          durationMinutes: dur,
          status: ServiceStatus.ACTIVE,
        };
        mockPrisma.service.create.mockResolvedValue(mockCreated);
        mockPrisma.service.findUnique.mockResolvedValue(mockCreated);

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

  describe('createService & updateService Staff Qualification Auto-Assignment', () => {
    it('should auto-assign all active stylists in salon when stylistIds is omitted', async () => {
      const activeStylists = [{ id: 'stylist-1' }, { id: 'stylist-2' }];
      mockPrisma.stylist.findMany.mockResolvedValue(activeStylists);

      const mockCreated = {
        id: 'new-service-id',
        salonId: mockSalonId,
        name: 'Beard Trim',
        price: 300,
        durationMinutes: 30,
        status: ServiceStatus.ACTIVE,
      };
      mockPrisma.service.create.mockResolvedValue(mockCreated);
      mockPrisma.service.findUnique.mockResolvedValue({
        ...mockCreated,
        stylists: activeStylists.map((st) => ({ stylistId: st.id })),
      });

      const result = await service.createService(mockSalonId, {
        name: 'Beard Trim',
        price: 300,
        durationMinutes: 30,
      });

      expect(mockPrisma.stylistService.createMany).toHaveBeenCalledWith({
        data: [
          { salonId: mockSalonId, stylistId: 'stylist-1', serviceId: 'new-service-id' },
          { salonId: mockSalonId, stylistId: 'stylist-2', serviceId: 'new-service-id' },
        ],
        skipDuplicates: true,
      });
      expect(result).toBeDefined();
    });

    it('should assign only specified stylists when stylistIds is explicitly provided', async () => {
      mockPrisma.stylist.findMany.mockResolvedValue([{ id: 'stylist-1' }]);

      const mockCreated = {
        id: 'new-service-id',
        salonId: mockSalonId,
        name: 'VIP Facial',
        price: 1500,
        durationMinutes: 60,
        status: ServiceStatus.ACTIVE,
      };
      mockPrisma.service.create.mockResolvedValue(mockCreated);
      mockPrisma.service.findUnique.mockResolvedValue(mockCreated);

      await service.createService(mockSalonId, {
        name: 'VIP Facial',
        price: 1500,
        durationMinutes: 60,
        stylistIds: ['stylist-1'],
      });

      expect(mockPrisma.stylistService.createMany).toHaveBeenCalledWith({
        data: [{ salonId: mockSalonId, stylistId: 'stylist-1', serviceId: 'new-service-id' }],
        skipDuplicates: true,
      });
    });

    it('should update assigned stylists in updateService when stylistIds is provided', async () => {
      mockPrisma.service.findFirst.mockResolvedValue({
        id: mockServiceId,
        salonId: mockSalonId,
        name: 'Hair Spa',
        price: 800,
        durationMinutes: 45,
      });
      mockPrisma.stylist.findMany.mockResolvedValue([{ id: 'stylist-2' }]);
      mockPrisma.service.findUnique.mockResolvedValue({
        id: mockServiceId,
        name: 'Hair Spa Premium',
        price: 900,
        durationMinutes: 45,
      });

      await service.updateService(mockSalonId, mockServiceId, {
        name: 'Hair Spa Premium',
        price: 900,
        stylistIds: ['stylist-2'],
      });

      expect(mockPrisma.stylistService.deleteMany).toHaveBeenCalledWith({
        where: { salonId: mockSalonId, serviceId: mockServiceId },
      });
      expect(mockPrisma.stylistService.createMany).toHaveBeenCalledWith({
        data: [{ salonId: mockSalonId, stylistId: 'stylist-2', serviceId: mockServiceId }],
        skipDuplicates: true,
      });
    });
  });

  describe('deleteService safety guards', () => {
    it('should block deletion if future active appointments exist', async () => {
      mockPrisma.service.findFirst.mockResolvedValue({
        id: mockServiceId,
        salonId: mockSalonId,
      });
      mockPrisma.appointment.count.mockResolvedValue(2); // 2 upcoming appointments

      await expect(service.deleteService(mockSalonId, mockServiceId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should allow deletion if zero future active appointments exist', async () => {
      mockPrisma.service.findFirst.mockResolvedValue({
        id: mockServiceId,
        salonId: mockSalonId,
      });
      mockPrisma.appointment.count.mockResolvedValue(0);
      mockPrisma.service.delete.mockResolvedValue({ id: mockServiceId });

      const res = await service.deleteService(mockSalonId, mockServiceId);
      expect(res).toBeDefined();
      expect(mockPrisma.service.delete).toHaveBeenCalledWith({ where: { id: mockServiceId } });
    });
  });

  describe('updateService duration rules (>= 30 and multiple of 15)', () => {
    beforeEach(() => {
      mockPrisma.service.findFirst.mockResolvedValue({
        id: mockServiceId,
        salonId: mockSalonId,
        name: 'Existing Service',
        price: 100,
        durationMinutes: 30,
        status: ServiceStatus.ACTIVE,
      });
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
        const mockUpdated = {
          id: mockServiceId,
          salonId: mockSalonId,
          name: 'Existing Service',
          price: 100,
          durationMinutes: dur,
          status: ServiceStatus.ACTIVE,
        };
        mockPrisma.service.update.mockResolvedValue(mockUpdated);
        mockPrisma.service.findUnique.mockResolvedValue(mockUpdated);

        const updated = await service.updateService(mockSalonId, mockServiceId, {
          durationMinutes: dur,
        });

        expect(updated.durationMinutes).toBe(dur);
      }
    });
  });
});

