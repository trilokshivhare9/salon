import { Test, TestingModule } from '@nestjs/testing';
import { AppointmentQueueService } from './queue.service';
import { PrismaService } from '../../../../database/prisma.service';
import { AppointmentStatus, BookingType } from '@prisma/client';
import { mapToQueueItem } from './mappers/queue-appointment.mapper';

describe('AppointmentQueueService & Queue Mappers', () => {
  let service: AppointmentQueueService;
  let mockPrisma: any;

  const mockSalonId = 'salon-test-123';

  const sampleDbAppointment = {
    id: 'appt-1',
    appointmentNumber: 'BK-1001',
    salonId: mockSalonId,
    status: AppointmentStatus.CHECKED_IN,
    source: 'WHATSAPP',
    bookingType: BookingType.NORMAL,
    startAt: new Date('2026-10-22T10:00:00Z'),
    endAt: new Date('2026-10-22T10:45:00Z'),
    durationMinutes: 45,
    price: 500,
    serviceNameSnapshot: 'Haircut',
    nextActionType: 'ARRIVAL_15M',
    nextActionAt: new Date('2026-10-22T09:45:00Z'),
    notes: 'VIP customer',
    salonUser: {
      id: 'su-1',
      user: {
        id: 'u-1',
        name: 'Rahul Sharma',
        phone: '+919876543210',
        email: 'rahul@example.com',
      },
    },
    stylist: {
      id: 'sty-1',
      name: 'Amit Barber',
      avatarUrl: null,
      colorCode: '#3B82F6',
    },
    services: [
      {
        id: 'as-1',
        serviceId: 's-1',
        serviceNameSnapshot: 'Haircut',
        durationMinutes: 30,
        price: 350,
        orderIndex: 0,
      },
      {
        id: 'as-2',
        serviceId: 's-2',
        serviceNameSnapshot: 'Beard Trim',
        durationMinutes: 15,
        price: 150,
        orderIndex: 1,
      },
    ],
    createdAt: new Date('2026-10-22T08:00:00Z'),
    updatedAt: new Date('2026-10-22T09:30:00Z'),
  };

  beforeEach(async () => {
    mockPrisma = {
      salon: {
        findUnique: jest.fn().mockResolvedValue({ id: mockSalonId, timezone: 'Asia/Kolkata' }),
      },
      appointment: {
        findMany: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AppointmentQueueService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<AppointmentQueueService>(AppointmentQueueService);
  });

  describe('mapToQueueItem', () => {
    it('should correctly map a complete DB appointment to canonical QueueItem', () => {
      const item = mapToQueueItem(sampleDbAppointment);

      expect(item.id).toBe('appt-1');
      expect(item.appointmentNumber).toBe('BK-1001');
      expect(item.status).toBe(AppointmentStatus.CHECKED_IN);
      expect(item.customer.name).toBe('Rahul Sharma');
      expect(item.customer.phone).toBe('+919876543210');
      expect(item.stylist.name).toBe('Amit Barber');
      expect(item.services.length).toBe(2);
      expect(item.services[0].name).toBe('Haircut');
      expect(item.services[1].name).toBe('Beard Trim');
      expect(item.totalDurationMinutes).toBe(45);
      expect(item.totalPrice).toBe(500);
      expect(item.nextActionType).toBe('ARRIVAL_15M');
      expect(item.nextActionAt).toEqual(sampleDbAppointment.nextActionAt);
    });
  });

  describe('getQueue', () => {
    it('should return operational queue with priority sorting and accurate summary counters', async () => {
      const apptChair = {
        ...sampleDbAppointment,
        id: 'appt-chair',
        status: AppointmentStatus.SEATED_IN_CHAIR,
        startAt: new Date('2026-10-22T10:00:00Z'),
      };
      const apptWaiting = {
        ...sampleDbAppointment,
        id: 'appt-waiting',
        status: AppointmentStatus.CHECKED_IN,
        startAt: new Date('2026-10-22T10:15:00Z'),
      };
      const apptUpcoming = {
        ...sampleDbAppointment,
        id: 'appt-upcoming',
        status: AppointmentStatus.CONFIRMED,
        startAt: new Date('2026-10-22T11:00:00Z'),
      };
      const apptCompleted = {
        ...sampleDbAppointment,
        id: 'appt-done',
        status: AppointmentStatus.COMPLETED,
        startAt: new Date('2026-10-22T09:00:00Z'),
      };

      // Passed out-of-order from DB
      mockPrisma.appointment.findMany.mockResolvedValue([
        apptUpcoming,
        apptCompleted,
        apptWaiting,
        apptChair,
      ]);

      const result = await service.getQueue(mockSalonId, {
        date: '2026-10-22',
        page: 1,
        limit: 10,
      });

      expect(result.success).toBe(true);
      expect(result.data.items.length).toBe(4);

      // Verify Operational Priority Ordering:
      // 1. SEATED_IN_CHAIR
      // 2. CHECKED_IN
      // 3. CONFIRMED
      // 4. COMPLETED
      expect(result.data.items[0].id).toBe('appt-chair');
      expect(result.data.items[1].id).toBe('appt-waiting');
      expect(result.data.items[2].id).toBe('appt-upcoming');
      expect(result.data.items[3].id).toBe('appt-done');

      // Verify Queue Summary counters
      expect(result.data.queueSummary.inChair).toBe(1);
      expect(result.data.queueSummary.checkedIn).toBe(1);
      expect(result.data.queueSummary.upcoming).toBe(1);
      expect(result.data.queueSummary.completed).toBe(1);
      expect(result.data.queueSummary.cancelled).toBe(0);

      // Verify Pagination
      expect(result.data.pagination.page).toBe(1);
      expect(result.data.pagination.totalItems).toBe(4);
      expect(result.data.pagination.totalPages).toBe(1);
    });
  });
});
