import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreateServiceDto, UpdateServiceDto } from './dto/create-service.dto';
import { ServiceStatus, SalonStatus, StylistStatus } from '@prisma/client';
import { AppointmentsService } from '../appointments/appointments.service';

@Injectable()
export class ServicesService {
  constructor(
    private prisma: PrismaService,
    private appointmentsService: AppointmentsService,
  ) {}

  private async syncSalonActiveStatus(salonId: string) {
    const activeStylistCount = await this.prisma.stylist.count({
      where: { salonId, status: StylistStatus.ACTIVE },
    });
    const activeServiceCount = await this.prisma.service.count({
      where: { salonId, status: ServiceStatus.ACTIVE },
    });

    const meetsRequirements = activeStylistCount >= 1 && activeServiceCount >= 1;
    await this.prisma.salon.update({
      where: { id: salonId },
      data: { status: meetsRequirements ? SalonStatus.ACTIVE : SalonStatus.INACTIVE },
    });
  }

  async getSalonServices(salonId: string) {
    return this.prisma.service.findMany({
      where: { salonId },
      include: {
        stylists: {
          include: {
            stylist: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getServiceById(salonId: string, serviceId: string) {
    const service = await this.prisma.service.findFirst({
      where: { id: serviceId, salonId },
      include: {
        stylists: {
          include: {
            stylist: true,
          },
        },
      },
    });

    if (!service) {
      throw new NotFoundException('Service not found.');
    }

    return service;
  }

  async createService(salonId: string, dto: CreateServiceDto) {
    const service = await this.prisma.service.create({
      data: {
        salonId,
        name: dto.name.trim(),
        description: dto.description?.trim(),
        price: dto.price,
        durationMinutes: dto.durationMinutes,
        category: dto.category?.trim(),
        status: ServiceStatus.ACTIVE,
      },
    });

    await this.syncSalonActiveStatus(salonId);
    this.appointmentsService.emitSalonEvent(salonId, 'SERVICE_UPDATED', { serviceId: service.id, action: 'CREATE' });
    return service;
  }

  async updateService(salonId: string, serviceId: string, dto: UpdateServiceDto) {
    await this.getServiceById(salonId, serviceId);

    const updated = await this.prisma.service.update({
      where: { id: serviceId },
      data: dto,
    });

    await this.syncSalonActiveStatus(salonId);
    this.appointmentsService.emitSalonEvent(salonId, 'SERVICE_UPDATED', { serviceId, action: 'UPDATE' });
    return updated;
  }

  async toggleServiceStatus(salonId: string, serviceId: string) {
    const service = await this.getServiceById(salonId, serviceId);
    const newStatus = service.status === ServiceStatus.ACTIVE ? ServiceStatus.INACTIVE : ServiceStatus.ACTIVE;

    const updated = await this.prisma.service.update({
      where: { id: serviceId },
      data: { status: newStatus },
    });

    await this.syncSalonActiveStatus(salonId);
    this.appointmentsService.emitSalonEvent(salonId, 'SERVICE_UPDATED', { serviceId, action: 'TOGGLE' });
    return updated;
  }

  async deleteService(salonId: string, serviceId: string) {
    await this.getServiceById(salonId, serviceId);

    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Remove appointments tied to this service so ON DELETE RESTRICT does not block deletion
      await tx.appointment.deleteMany({
        where: { salonId, serviceId },
      });

      // 2. Clear active conversation reference if any
      await tx.conversation.updateMany({
        where: { salonId, selectedServiceId: serviceId },
        data: { selectedServiceId: null },
      });

      // 3. Delete the service record (Prisma cascades stylist_services)
      const deleted = await tx.service.delete({
        where: { id: serviceId },
      });

      // 4. Sync salon active status (auto-deactivates if < 1 active stylist or service)
      const activeStylistCount = await tx.stylist.count({
        where: { salonId, status: StylistStatus.ACTIVE },
      });
      const activeServiceCount = await tx.service.count({
        where: { salonId, status: ServiceStatus.ACTIVE },
      });
      const meetsRequirements = activeStylistCount >= 1 && activeServiceCount >= 1;
      await tx.salon.update({
        where: { id: salonId },
        data: { status: meetsRequirements ? SalonStatus.ACTIVE : SalonStatus.INACTIVE },
      });

      return deleted;
    });

    this.appointmentsService.emitSalonEvent(salonId, 'SERVICE_UPDATED', { serviceId, action: 'DELETE' });
    return result;
  }
}
