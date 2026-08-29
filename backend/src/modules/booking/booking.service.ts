import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AvailabilityService } from '../availability/availability.service';
import { AppointmentsService } from '../appointments/appointments.service';
import { CreateAppointmentDto } from '../appointments/dto/create-appointment.dto';
import { BookingSource } from '@prisma/client';

@Injectable()
export class BookingService {
  constructor(
    private prisma: PrismaService,
    private availabilityService: AvailabilityService,
    private appointmentsService: AppointmentsService,
  ) {}

  async getSalonBySlug(slug: string) {
    const salon = await this.prisma.salon.findUnique({
      where: { slug },
      select: {
        id: true,
        name: true,
        slug: true,
        logoUrl: true,
        phone: true,
        email: true,
        address: true,
        city: true,
        state: true,
        country: true,
        timezone: true,
        description: true,
        status: true,
        slotIntervalMinutes: true,
        minAdvanceNoticeMins: true,
        maxAdvanceDays: true,
        cancelWindowHours: true,
        allowSpecificStaff: true,
        services: {
          where: { status: 'ACTIVE' },
          select: {
            id: true,
            name: true,
            description: true,
            price: true,
            durationMinutes: true,
            category: true,
          },
          orderBy: { category: 'asc' },
        },
        staff: {
          where: { status: 'ACTIVE' },
          select: {
            id: true,
            name: true,
            profileImageUrl: true,
            services: { select: { serviceId: true } },
          },
        },
      },
    });

    if (!salon || salon.status !== 'ACTIVE') {
      throw new NotFoundException('Salon not found or inactive.');
    }

    return salon;
  }

  async getAvailability(
    slug: string,
    serviceId: string,
    date: string,
    staffId?: string,
  ) {
    const salon = await this.getSalonBySlug(slug);
    return this.availabilityService.getAvailableSlots(
      salon.id,
      serviceId,
      date,
      staffId,
    );
  }

  async createPublicAppointment(slug: string, dto: CreateAppointmentDto) {
    const salon = await this.getSalonBySlug(slug);
    dto.source = BookingSource.WEB;

    const appointment = await this.appointmentsService.createAppointment(
      salon.id,
      dto,
    );

    return {
      appointmentId: appointment.id,
      appointmentNumber: appointment.appointmentNumber,
      status: appointment.status,
      serviceName: appointment.service.name,
      staffName: appointment.staff.name,
      date: appointment.date,
      startTime: appointment.startTime,
      endTime: appointment.endTime,
      price: appointment.price,
      customer: {
        name: appointment.customer.name,
        phone: appointment.customer.phone,
      },
      salon: {
        name: salon.name,
        address: salon.address,
        phone: salon.phone,
      },
    };
  }
}
