import { Test, TestingModule } from '@nestjs/testing';
import { StaffService } from '../../../../src/modules/salon-admin/staff/staff.service';
import { PrismaService } from '../../../../src/database/prisma.service';
import { AppointmentsService } from '../../../../src/modules/salon-admin/appointments/appointments.service';
import { StylistStatusEngine } from '../../../../src/modules/salon-admin/staff/engines/stylist-status.engine';
import { BadRequestException } from '@nestjs/common';
import { AppointmentStatus, StylistStatus, ServiceStatus, SalonStatus } from '@prisma/client';

describe('StaffService - deleteStaff Safety Guards', () => {
  let service: StaffService;
  let prismaMock: any;
  let appointmentsServiceMock: any;

  beforeEach(async () => {
    prismaMock = {
      stylist: {
        findFirst: jest.fn(),
        count: jest.fn().mockResolvedValue(2),
        delete: jest.fn().mockResolvedValue({ id: 'staff-1', name: 'John Stylist' }),
      },
      service: {
        count: jest.fn().mockResolvedValue(5),
      },
      salon: {
        update: jest.fn().mockResolvedValue({ id: 'salon-1', status: SalonStatus.ACTIVE }),
      },
      appointment: {
        count: jest.fn(),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      conversation: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      $transaction: jest.fn(async (cb) => cb(prismaMock)),
    };

    appointmentsServiceMock = {
      emitSalonEvent: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StaffService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: AppointmentsService, useValue: appointmentsServiceMock },
        {
          provide: StylistStatusEngine,
          useValue: {
            resolveSalonStaffStatuses: jest.fn().mockResolvedValue(new Map()),
            attachOperationalStatus: jest.fn((stylist) => stylist),
          },
        },
      ],
    }).compile();

    service = module.get<StaffService>(StaffService);
  });

  it('should block deletion if active appointments exist for this stylist', async () => {
    prismaMock.stylist.findFirst.mockResolvedValue({
      id: 'staff-1',
      name: 'John Stylist',
      salonId: 'salon-1',
    });

    // Simulate 2 active bookings
    prismaMock.appointment.count.mockResolvedValue(2);

    await expect(service.deleteStaff('salon-1', 'staff-1')).rejects.toThrow(BadRequestException);
    await expect(service.deleteStaff('salon-1', 'staff-1')).rejects.toThrow(
      /Cannot delete stylist: There are 2 active booking\(s\) assigned to this specialist\. Please reschedule or cancel these active bookings first before deleting the stylist\./,
    );

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.stylist.delete).not.toHaveBeenCalled();
  });

  it('should allow deletion if zero active appointments exist', async () => {
    prismaMock.stylist.findFirst.mockResolvedValue({
      id: 'staff-1',
      name: 'John Stylist',
      salonId: 'salon-1',
    });

    // Zero active bookings
    prismaMock.appointment.count.mockResolvedValue(0);

    const result = await service.deleteStaff('salon-1', 'staff-1');

    expect(result).toBeDefined();
    expect(result.id).toBe('staff-1');
    expect(prismaMock.$transaction).toHaveBeenCalled();
    expect(prismaMock.stylist.delete).toHaveBeenCalledWith({ where: { id: 'staff-1' } });
    expect(appointmentsServiceMock.emitSalonEvent).toHaveBeenCalledWith(
      'salon-1',
      'STAFF_UPDATED',
      { staffId: 'staff-1', action: 'DELETE' },
    );
  });
});
